"use server";

import { revalidatePath } from "next/cache";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import type { PromptKind } from "@/generated/prisma/client";

const PROMPT_DIR = join(process.cwd(), "src", "lib", "ai", "prompts");

const FILE_MAP: Record<PromptKind, string> = {
  critical_review: "critical-review.md",
  paper_skeleton: "skeleton.md",
  section_polish: "polish.md",
  outer_loop_audit: "outer-loop-audit.md",
};

export async function upsertPromptTemplate(kind: PromptKind, formData: FormData) {
  const bodyMd = String(formData.get("bodyMd") ?? "").trim();
  if (!bodyMd) return;
  const existing = await prisma.promptTemplate.findUnique({ where: { kind } });
  if (existing) {
    await prisma.promptTemplate.update({
      where: { kind },
      data: { bodyMd, version: existing.version + 1 },
    });
  } else {
    await prisma.promptTemplate.create({
      data: { kind, bodyMd, version: 1 },
    });
  }
  revalidatePath("/settings");
}

export async function resetPromptTemplate(kind: PromptKind) {
  await prisma.promptTemplate.deleteMany({ where: { kind } });
  revalidatePath("/settings");
}

export async function loadDefaultPrompt(kind: PromptKind): Promise<string> {
  return readFile(join(PROMPT_DIR, FILE_MAP[kind]), "utf8");
}
