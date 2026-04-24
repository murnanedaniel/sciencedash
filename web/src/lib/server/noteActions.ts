"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { NoteKind } from "@/generated/prisma/client";

function extractArxivId(s: string): string | null {
  const m = s.match(/(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})/i);
  return m ? m[1]! : null;
}

export async function createNote(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim() || null;
  const arxivId = url ? extractArxivId(url) : null;
  const title = String(formData.get("title") ?? "").trim() ||
    (arxivId ? `arXiv:${arxivId}` : "(untitled)");
  const authors = String(formData.get("authors") ?? "").trim() || null;
  const kind = (String(formData.get("kind") ?? "paper") as NoteKind);
  const takeaway = String(formData.get("takeaway") ?? "").trim() || null;
  const summaryMd = String(formData.get("summaryMd") ?? "").trim() || null;
  const projectIds = String(formData.get("projectIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await prisma.note.create({
    data: {
      kind,
      title,
      authors,
      url,
      arxivId,
      takeaway,
      summaryMd,
      projects: {
        create: projectIds.map((projectId) => ({ projectId })),
      },
    },
  });
  revalidatePath("/reading");
}

export async function deleteNote(id: string) {
  await prisma.note.delete({ where: { id } });
  revalidatePath("/reading");
}

export async function patchNoteField(
  id: string,
  field: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = new Set(["title", "authors", "url", "takeaway", "summaryMd", "arxivId"]);
  if (!allowed.has(field)) return { ok: false, error: "bad field" };
  const v = value.trim();
  await prisma.note.update({
    where: { id },
    data: { [field]: v.length ? v : null },
  });
  revalidatePath("/reading");
  return { ok: true };
}
