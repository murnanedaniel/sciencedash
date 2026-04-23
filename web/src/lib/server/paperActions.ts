"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SECTION_SEEDS } from "@/lib/paperTemplate";
import { recordDecision } from "@/lib/server/decisions";
import { storeArtifactFile } from "@/lib/server/artifacts";
import type { PaperStatus, PaperSectionKind } from "@/generated/prisma/client";

export async function createBlankPaper(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const primaryProjectId = String(formData.get("primaryProjectId") ?? "").trim() || null;
  if (!title) return;
  const paper = await prisma.paper.create({
    data: {
      title,
      primaryProjectId,
      sections: {
        create: DEFAULT_SECTION_SEEDS.map((s, i) => ({
          kind: s.kind,
          title: s.title,
          contentMd: s.contentMd,
          order: i,
        })),
      },
    },
  });
  await recordDecision({
    kind: "spawn_paper",
    subjectType: "Paper",
    subjectId: paper.id,
    projectId: primaryProjectId,
    rationale: `blank paper created: ${title}`,
  });
  revalidatePath("/papers");
  redirect(`/papers/${paper.id}`);
}

export async function spawnPaperFromHypothesis(hypothesisId: string) {
  const h = await prisma.hypothesis.findUniqueOrThrow({
    where: { id: hypothesisId },
    include: { project: true, runs: { include: { metrics: { include: { definition: true } } } } },
  });
  const metricLine = h.runs
    .flatMap((r) => r.metrics)
    .map((m) => `${m.definition.name}=${m.value}${m.definition.unit ?? ""}`)
    .slice(0, 6)
    .join(", ");

  const abstract = [
    h.statement ?? `We investigate ${h.title}.`,
    h.runs.length
      ? `Across ${h.runs.length} run(s) on ${h.project.title}, we observe ${metricLine || "consistent signal"}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const paper = await prisma.paper.create({
    data: {
      title: h.title,
      abstract,
      primaryProjectId: h.project.id,
      sections: {
        create: DEFAULT_SECTION_SEEDS.map((s, i) => ({
          kind: s.kind,
          title: s.title,
          contentMd: s.contentMd,
          order: i,
        })),
      },
      hypotheses: { create: [{ hypothesisId }] },
    },
  });

  await prisma.hypothesis.update({
    where: { id: hypothesisId },
    data: { verdict: "spawned_paper", status: "resolved", resolvedAt: new Date() },
  });

  await recordDecision({
    kind: "spawn_paper",
    subjectType: "Paper",
    subjectId: paper.id,
    projectId: h.projectId,
    rationale: `spawned from hypothesis ${h.title}`,
  });

  revalidatePath(`/projects/${h.projectId}`);
  revalidatePath("/papers");
  redirect(`/papers/${paper.id}`);
}

export async function setPaperStatus(paperId: string, formData: FormData) {
  const status = String(formData.get("status") ?? "") as PaperStatus;
  const arxivId = String(formData.get("arxivId") ?? "").trim() || null;
  const doi = String(formData.get("doi") ?? "").trim() || null;
  const venue = String(formData.get("venue") ?? "").trim() || null;
  const paper = await prisma.paper.update({
    where: { id: paperId },
    data: {
      status,
      arxivId,
      doi,
      venue,
      submittedAt: status === "submitted" ? new Date() : undefined,
      publishedAt: status === "published" ? new Date() : undefined,
    },
    select: { primaryProjectId: true },
  });
  await recordDecision({
    kind: "paper_status_change",
    subjectType: "Paper",
    subjectId: paperId,
    projectId: paper.primaryProjectId,
    rationale: `status → ${status}`,
  });
  revalidatePath(`/papers/${paperId}`);
  revalidatePath(`/papers`);
}

export async function patchPaperField(
  id: string,
  field: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = new Set(["title", "abstract", "arxivId", "doi", "venue", "plannedVenue"]);
  if (!allowed.has(field)) return { ok: false, error: "bad field" };
  const v = value.trim();
  await prisma.paper.update({
    where: { id },
    data: { [field]: v.length ? v : null },
  });
  revalidatePath(`/papers/${id}`);
  return { ok: true };
}

export async function patchSectionField(
  id: string,
  field: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = new Set(["title", "contentMd"]);
  if (!allowed.has(field)) return { ok: false, error: "bad field" };
  const s = await prisma.paperSection.update({
    where: { id },
    data: { [field]: field === "title" ? value.trim() : value },
    select: { paperId: true },
  });
  revalidatePath(`/papers/${s.paperId}`);
  return { ok: true };
}

export async function addCustomSection(paperId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim() || "Custom";
  const kind = (String(formData.get("kind") ?? "custom") as PaperSectionKind);
  const last = await prisma.paperSection.findFirst({
    where: { paperId },
    orderBy: { order: "desc" },
  });
  await prisma.paperSection.create({
    data: {
      paperId,
      kind,
      title,
      order: (last?.order ?? 0) + 1,
    },
  });
  revalidatePath(`/papers/${paperId}`);
}

export async function deleteSection(id: string) {
  const s = await prisma.paperSection.delete({
    where: { id },
    select: { paperId: true },
  });
  revalidatePath(`/papers/${s.paperId}`);
}

export async function deletePaper(id: string) {
  await prisma.paper.delete({ where: { id } });
  revalidatePath("/papers");
  redirect("/papers");
}

export async function uploadArtifact(
  scope: { paperId?: string; paperSectionId?: string; projectId?: string; runId?: string },
  formData: FormData,
) {
  const file = formData.get("file");
  const caption = String(formData.get("caption") ?? "").trim() || null;
  const kind = (String(formData.get("kind") ?? "figure") as
    | "figure"
    | "checkpoint"
    | "table"
    | "slide"
    | "dataset"
    | "other");
  if (!(file instanceof File) || file.size === 0) return;
  const { path } = await storeArtifactFile(file);
  await prisma.artifact.create({
    data: {
      kind,
      path,
      caption,
      paperId: scope.paperId ?? null,
      paperSectionId: scope.paperSectionId ?? null,
      projectId: scope.projectId ?? null,
      runId: scope.runId ?? null,
    },
  });
  if (scope.paperId) revalidatePath(`/papers/${scope.paperId}`);
  if (scope.projectId) revalidatePath(`/projects/${scope.projectId}`);
}

export async function deleteArtifact(id: string) {
  const a = await prisma.artifact.delete({
    where: { id },
    select: { paperId: true, projectId: true },
  });
  if (a.paperId) revalidatePath(`/papers/${a.paperId}`);
  if (a.projectId) revalidatePath(`/projects/${a.projectId}`);
}
