"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function reviveWorkhorseAction(formData: FormData): Promise<void> {
  const workhorseId = String(formData.get("workhorseId") ?? "");
  if (!workhorseId) return;
  const w = await prisma.workhorse.findUnique({
    where: { id: workhorseId },
    select: { host: true, projectId: true, sessionName: true },
  });
  if (!w) return;
  await prisma.agentMessage.create({
    data: {
      projectId: w.projectId,
      kind: "directive",
      severity: "info",
      source: `dashboard@${w.host}:${w.sessionName}`,
      body: "revive_session",
      payloadJson: null,
    },
  });
  revalidatePath(`/projects/${w.projectId}`);
}

/**
 * Queue a `workhorse_tick` directive for a specific workhorse session.
 * sync.py picks it up on its next 60s tick and tmux send-keys the prompt
 * into the running Claude REPL. Optional custom prompt via formData.prompt.
 *
 * Idempotency: if an unread `workhorse_tick` directive is already pending
 * for this exact (host, sessionName) channel, this is a no-op so a
 * double-click doesn't queue two prompts back-to-back.
 */
export async function tickWorkhorseAction(formData: FormData): Promise<void> {
  const workhorseId = String(formData.get("workhorseId") ?? "");
  if (!workhorseId) return;
  const w = await prisma.workhorse.findUnique({
    where: { id: workhorseId },
    select: { host: true, projectId: true, sessionName: true },
  });
  if (!w) return;
  const source = `dashboard@${w.host}:${w.sessionName}`;
  const existing = await prisma.agentMessage.findFirst({
    where: {
      projectId: w.projectId,
      kind: "directive",
      source,
      body: "workhorse_tick",
      readAt: null,
    },
    select: { id: true },
  });
  if (existing) {
    revalidatePath(`/projects/${w.projectId}`);
    return;
  }
  const customPrompt = String(formData.get("prompt") ?? "").trim();
  await prisma.agentMessage.create({
    data: {
      projectId: w.projectId,
      kind: "directive",
      severity: "info",
      source,
      body: "workhorse_tick",
      payloadJson: customPrompt ? JSON.stringify({ prompt: customPrompt }) : null,
    },
  });
  revalidatePath(`/projects/${w.projectId}`);
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
