"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

async function runWorkhorseTool(tool: string, args: Record<string, unknown>) {
  const { callTool } = await import("@/lib/mcp/server");
  const result = await callTool(tool, args);
  if (result.isError) throw new Error(JSON.stringify(result.content));
}

async function changeWorkhorse(formData: FormData, tool: string) {
  const id = String(formData.get("workhorseId") ?? "");
  if (!id) return;
  const w = await prisma.workhorse.findUnique({ where: { id } });
  if (!w) return;
  await runWorkhorseTool(tool, tool === "remove_workhorse" ? { id } : {
    projectId: w.projectId, bridgeName: w.bridgeName,
  });
  revalidatePath(`/projects/${w.projectId}`);
  revalidatePath("/settings");
}

export async function stopWorkhorseAction(formData: FormData): Promise<void> {
  await changeWorkhorse(formData, "stop_all_workhorses");
}

export async function resumeWorkhorseAction(formData: FormData): Promise<void> {
  await changeWorkhorse(formData, "resume_workhorse");
}

export async function removeWorkhorseAction(formData: FormData): Promise<void> {
  await changeWorkhorse(formData, "remove_workhorse");
}

export async function stopAllWorkhorsesAction(): Promise<void> {
  await runWorkhorseTool("stop_all_workhorses", {});
  revalidatePath("/", "layout");
}

export async function markMessageReadAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const msg = await prisma.agentMessage.update({
    where: { id },
    data: { readAt: new Date() },
    select: { projectId: true },
  });
  revalidatePath(`/projects/${msg.projectId}`);
}

export async function markAllMessagesReadAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  await prisma.agentMessage.updateMany({
    where: { projectId, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteMessageAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const msg = await prisma.agentMessage.findUnique({
    where: { id },
    select: { projectId: true },
  });
  if (!msg) return;
  await prisma.agentMessage.delete({ where: { id } });
  revalidatePath(`/projects/${msg.projectId}`);
}
