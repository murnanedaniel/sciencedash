"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { ProgrammeStatus } from "@/generated/prisma/client";

const SIMPLE_TEXT_FIELDS = new Set([
  "name",
  "description",
  "targetVenues",
  "figuresOfMerit",
  "narrativeReadinessNote",
]);

/**
 * Create a new programme. Redirects to its detail page on success so the
 * user can immediately attach projects + fill in the thesis.
 */
export async function createProgrammeAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const description = optionalString(formData.get("description"));
  const targetVenues = optionalString(formData.get("targetVenues"));
  const figuresOfMerit = optionalString(formData.get("figuresOfMerit"));
  const programme = await prisma.programme.create({
    data: { name, description, targetVenues, figuresOfMerit },
  });
  revalidatePath("/programmes");
  redirect(`/programmes/${programme.id}`);
}

/**
 * Inline-edit any of the simple text fields on a programme. Mirrors
 * `patchProjectField` so the same `<InlineField>` component can drive
 * programme detail edits with minimal new surface.
 */
export async function patchProgrammeField(
  id: string,
  field: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SIMPLE_TEXT_FIELDS.has(field)) {
    return { ok: false, error: `unknown field: ${field}` };
  }
  const v = value.trim();
  if (field === "name") {
    if (!v) return { ok: false, error: "name cannot be empty" };
    // Unique constraint on Programme.name — surface a helpful error if
    // the user picks a duplicate. Prisma throws P2002 on unique
    // violation; we map that to a clean message.
    try {
      await prisma.programme.update({ where: { id }, data: { name: v } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg.includes("Unique") ? "another programme already has that name" : msg };
    }
  } else {
    await prisma.programme.update({
      where: { id },
      data: { [field]: v.length ? v : null },
    });
  }
  revalidatePath(`/programmes/${id}`);
  revalidatePath("/programmes");
  return { ok: true };
}

export async function setProgrammeStatusAction(
  id: string,
  formData: FormData,
): Promise<void> {
  const raw = String(formData.get("status") ?? "");
  if (raw !== "active" && raw !== "parked") return;
  await prisma.programme.update({
    where: { id },
    data: { status: raw as ProgrammeStatus },
  });
  revalidatePath(`/programmes/${id}`);
  revalidatePath("/programmes");
}

/**
 * Attach (or detach) a project to a programme. `programmeId === ""`
 * detaches. Called from the project Overview tab's programme
 * dropdown. No cascade — Programme just gains/loses a child.
 */
export async function setProjectProgrammeAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const programmeIdRaw = String(formData.get("programmeId") ?? "");
  if (!projectId) return;
  const programmeId = programmeIdRaw === "" ? null : programmeIdRaw;
  await prisma.project.update({
    where: { id: projectId },
    data: { programmeId },
  });
  revalidatePath(`/projects/${projectId}`);
  if (programmeId) revalidatePath(`/programmes/${programmeId}`);
  revalidatePath("/programmes");
}

/**
 * Hard-delete a programme. Children's `programmeId` is cleared by the
 * FK's onDelete:SetNull — the projects survive. We confirm at the form
 * level (browser confirm()), no double-confirm here.
 */
export async function deleteProgrammeAction(id: string): Promise<void> {
  await prisma.programme.delete({ where: { id } });
  revalidatePath("/programmes");
  redirect("/programmes");
}

function optionalString(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
