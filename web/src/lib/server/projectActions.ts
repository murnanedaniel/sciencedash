"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/tags";
import { recordDecision } from "@/lib/server/decisions";
import { checkPromotion } from "@/lib/server/promotion";
import type {
  ProjectStatus,
  NarrativeReadiness,
  HypothesisStatus,
  HypothesisVerdict,
  MetricDirection,
} from "@/generated/prisma/client";

const SIMPLE_TEXT_FIELDS = new Set([
  "title",
  "description",
  "hypothesis",
  "figuresOfMerit",
  "timeline",
  "nextSteps",
  "githubRepoUrl",
  "blockers",
  "narrativeReadinessNote",
  "wandbEntity",
  "wandbProject",
]);

export async function patchProjectField(
  id: string,
  field: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SIMPLE_TEXT_FIELDS.has(field)) {
    return { ok: false, error: `unknown field: ${field}` };
  }
  const v = value.trim();
  await prisma.project.update({
    where: { id },
    data: { [field]: v.length ? v : null },
  });
  revalidatePath(`/projects/${id}`);
  return { ok: true };
}

export async function patchHypothesisField(
  id: string,
  field: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ok = new Set(["title", "statement"]);
  if (!ok.has(field)) return { ok: false, error: "bad field" };
  const v = value.trim();
  const hyp = await prisma.hypothesis.update({
    where: { id },
    data: { [field]: v.length ? v : null },
    select: { projectId: true },
  });
  revalidatePath(`/projects/${hyp.projectId}`);
  return { ok: true };
}

export async function updateProjectTags(projectId: string, formData: FormData) {
  const raw = String(formData.get("tags") ?? "");
  const tags = parseTags(raw);
  await prisma.project.update({
    where: { id: projectId },
    data: {
      tags: {
        set: [],
        connectOrCreate: tags.map((name) => ({
          where: { name },
          create: { name },
        })),
      },
    },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function setProjectStatus(projectId: string, formData: FormData) {
  const next = String(formData.get("status") ?? "") as ProjectStatus;
  const rationale = (String(formData.get("rationale") ?? "") || "").trim();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      hypotheses: { select: { id: true } },
      metricDefinitions: { select: { id: true, isPrimary: true } },
    },
  });
  if (!project) return;

  // Promotion gate: idea -> active must satisfy §16.1.
  if (project.status === "idea" && next === "active") {
    const gate = checkPromotion(project, project.hypotheses, project.metricDefinitions);
    if (!gate.ok) {
      // Stash missing-fields in URL so the page renders the alert.
      redirect(
        `/projects/${projectId}?gate=${encodeURIComponent(gate.missing.join("|"))}`,
      );
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: next },
  });

  const kind =
    next === "active" && project.status === "idea"
      ? "promote"
      : next === "parked"
        ? "park"
        : next === "shipped"
          ? "resolve"
          : next === "blocked"
            ? "narrow"
            : "other";

  await recordDecision({
    kind,
    subjectType: "Project",
    subjectId: projectId,
    projectId,
    rationale: rationale || `status: ${project.status} → ${next}`,
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects`);
}

export async function setProjectNarrativeReadiness(
  projectId: string,
  formData: FormData,
) {
  const next = String(formData.get("narrativeReadiness") ?? "") as NarrativeReadiness;
  await prisma.project.update({
    where: { id: projectId },
    data: { narrativeReadiness: next },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function toggleAiAutoReview(projectId: string) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { aiAutoReviewEnabled: true },
  });
  if (!p) return;
  await prisma.project.update({
    where: { id: projectId },
    data: { aiAutoReviewEnabled: !p.aiAutoReviewEnabled },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProject(id: string) {
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
  redirect("/projects");
}

export async function createHypothesis(projectId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const statement = String(formData.get("statement") ?? "").trim() || null;
  const budget = Number(formData.get("computeBudgetGpuHours") ?? 10);
  if (!title) return;
  const h = await prisma.hypothesis.create({
    data: {
      projectId,
      title,
      statement,
      computeBudgetGpuHours: Number.isFinite(budget) ? budget : 10,
    },
  });
  await recordDecision({
    kind: "other",
    subjectType: "Hypothesis",
    subjectId: h.id,
    projectId,
    rationale: `hypothesis created: ${title}`,
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function setHypothesisVerdict(
  hypothesisId: string,
  formData: FormData,
) {
  const verdict = String(formData.get("verdict") ?? "") as HypothesisVerdict;
  const status = String(formData.get("status") ?? "resolved") as HypothesisStatus;
  const h = await prisma.hypothesis.update({
    where: { id: hypothesisId },
    data: {
      verdict,
      status,
      resolvedAt: status === "resolved" ? new Date() : null,
    },
    select: { projectId: true, title: true },
  });
  await recordDecision({
    kind: "resolve",
    subjectType: "Hypothesis",
    subjectId: hypothesisId,
    projectId: h.projectId,
    rationale: `verdict: ${verdict}`,
  });
  revalidatePath(`/projects/${h.projectId}`);
}

export async function deleteHypothesis(hypothesisId: string) {
  const h = await prisma.hypothesis.delete({
    where: { id: hypothesisId },
    select: { projectId: true },
  });
  revalidatePath(`/projects/${h.projectId}`);
}

export async function createMetricDefinition(
  projectId: string,
  formData: FormData,
) {
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const direction = (String(formData.get("direction") ?? "higher") as MetricDirection);
  const isPrimary = formData.get("isPrimary") === "on";
  const threshold = Number(formData.get("threshold"));
  if (!name) return;

  if (isPrimary) {
    await prisma.projectMetricDefinition.updateMany({
      where: { projectId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
  await prisma.projectMetricDefinition.create({
    data: {
      projectId,
      name,
      unit,
      direction,
      isPrimary,
      threshold: Number.isFinite(threshold) ? threshold : null,
    },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteMetricDefinition(id: string) {
  const m = await prisma.projectMetricDefinition.delete({
    where: { id },
    select: { projectId: true },
  });
  revalidatePath(`/projects/${m.projectId}`);
}

export async function createRun(hypothesisId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const wandbRunId = String(formData.get("wandbRunId") ?? "").trim() || null;
  const computeGpuHours = Number(formData.get("computeGpuHours") ?? 0);
  const endedAtStr = String(formData.get("endedAt") ?? "").trim();
  if (!name) return;

  const run = await prisma.run.create({
    data: {
      hypothesisId,
      name,
      notes,
      wandbRunId,
      computeGpuHours: Number.isFinite(computeGpuHours) ? computeGpuHours : 0,
      status: "done",
      endedAt: endedAtStr ? new Date(endedAtStr) : new Date(),
    },
  });

  // Attach any metric values for each existing ProjectMetricDefinition.
  const h = await prisma.hypothesis.findUniqueOrThrow({
    where: { id: hypothesisId },
    select: { projectId: true },
  });
  const defs = await prisma.projectMetricDefinition.findMany({
    where: { projectId: h.projectId },
  });
  for (const def of defs) {
    const raw = formData.get(`metric:${def.id}`);
    if (raw == null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    await prisma.metric.create({
      data: { runId: run.id, definitionId: def.id, value: v },
    });
  }

  revalidatePath(`/projects/${h.projectId}`);
}

export async function deleteRun(runId: string) {
  const r = await prisma.run.delete({
    where: { id: runId },
    include: { hypothesis: { select: { projectId: true } } },
  });
  revalidatePath(`/projects/${r.hypothesis.projectId}`);
}
