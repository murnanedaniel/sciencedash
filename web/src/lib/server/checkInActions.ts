"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function createCheckIn(
  scope: { scope: "project" | "portfolio" | "paper"; scopeId?: string | null },
  formData: FormData,
) {
  const bodyMd = String(formData.get("bodyMd") ?? "").trim();
  if (!bodyMd) return;
  await prisma.checkIn.create({
    data: {
      scope: scope.scope,
      projectId: scope.scope === "project" ? (scope.scopeId ?? null) : null,
      bodyMd,
      source: "manual",
    },
  });
  revalidatePath("/");
  if (scope.scope === "project" && scope.scopeId) {
    revalidatePath(`/projects/${scope.scopeId}`);
  }
  if (scope.scope === "paper" && scope.scopeId) {
    revalidatePath(`/papers/${scope.scopeId}`);
  }
}

export async function deleteCheckIn(id: string) {
  const c = await prisma.checkIn.delete({
    where: { id },
    select: { projectId: true },
  });
  revalidatePath("/");
  if (c.projectId) revalidatePath(`/projects/${c.projectId}`);
}

export async function applyProposedPatch(
  checkInId: string,
  patchIndex: number,
): Promise<void> {
  const c = await prisma.checkIn.findUniqueOrThrow({
    where: { id: checkInId },
  });
  if (!c.proposedPatchJson || !c.projectId) {
    return;
  }
  let patches: Array<{ path: string; value: string | number | boolean }>;
  try {
    const parsed = JSON.parse(c.proposedPatchJson) as {
      proposedPatches?: typeof patches;
    };
    patches = parsed.proposedPatches ?? [];
  } catch {
    return;
  }
  const patch = patches[patchIndex];
  if (!patch) return;

  const [model, field] = patch.path.split(".", 2);
  if (model === "project") {
    const allowed = new Set([
      "hypothesis",
      "figuresOfMerit",
      "timeline",
      "nextSteps",
      "blockers",
      "narrativeReadinessNote",
    ]);
    if (!allowed.has(field!)) return;
    await prisma.project.update({
      where: { id: c.projectId },
      data: { [field!]: String(patch.value) },
    });
  } else if (model === "narrativeReadiness") {
    await prisma.project.update({
      where: { id: c.projectId },
      data: { narrativeReadiness: String(patch.value) as never },
    });
  }

  // Mark this patch applied by rewriting the JSON.
  const next = JSON.parse(c.proposedPatchJson);
  if (Array.isArray(next.proposedPatches)) {
    next.proposedPatches[patchIndex].applied = true;
  }
  await prisma.checkIn.update({
    where: { id: checkInId },
    data: { proposedPatchJson: JSON.stringify(next) },
  });

  await prisma.decision.create({
    data: {
      kind: "ai_patch_applied",
      subjectType: "Project",
      subjectId: c.projectId,
      projectId: c.projectId,
      rationale: `${patch.path} ← ${String(patch.value).slice(0, 120)}`,
    },
  });

  revalidatePath(`/projects/${c.projectId}`);
  revalidatePath("/");
}
