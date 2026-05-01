"use server";

import { revalidatePath } from "next/cache";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

/**
 * Set (or clear) the project's brain directive. Stored canonically on
 * Project.brainDirective; mirrored to <localPath>/.sciencedash/HUMAN_DIRECTIVE.md
 * if localPath is set, so a terminal Claude session can also see it.
 *
 * Set body to empty string to clear the directive.
 */
export async function setHumanDirectiveAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!projectId) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { localPath: true },
  });
  if (!project) return;

  if (body.length === 0) {
    // Clear: remove DB entry; remove file mirror if present.
    await prisma.project.update({
      where: { id: projectId },
      data: { brainDirective: null },
    });
    if (project.localPath) {
      const file = path.join(project.localPath, ".sciencedash", "HUMAN_DIRECTIVE.md");
      await fs.rm(file, { force: true }).catch(() => null);
    }
  } else {
    await prisma.project.update({
      where: { id: projectId },
      data: {
        brainDirective: body,
        brainDirectiveSetAt: new Date(),
      },
    });
    if (project.localPath) {
      const dir = path.join(project.localPath, ".sciencedash");
      const file = path.join(dir, "HUMAN_DIRECTIVE.md");
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file, body + "\n", "utf-8");
      } catch {
        // best-effort — DB is canonical
      }
    }
  }

  revalidatePath(`/projects/${projectId}`);
}
