"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/** Manually assign (or clear) a conversation thread's project — the "confirm"
 *  half of robust association: git-remote auto-tags what it can; this lets the
 *  user/Claude tag the rest (e.g. /tmp or home sessions). */
export async function setThreadProject(formData: FormData) {
  const sessionId = String(formData.get("sessionId") || "").trim();
  const raw = String(formData.get("projectId") || "").trim();
  if (!sessionId) return;
  const projectId = raw === "" ? null : raw;
  await prisma.thread.update({ where: { sessionId }, data: { projectId } });
  revalidatePath(`/threads/${sessionId}`);
}
