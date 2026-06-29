/**
 * Project brain heartbeat — one cycle of stateless-LLM-with-stateful-memory.
 *
 * Each cycle:
 *   1. Assemble memory (PROJECT_BRIEF + MEMORY_LOG + HUMAN_DIRECTIVE).
 *   2. Spawn a fresh `claude -p` via the Agent SDK with MCP tools loaded.
 *   3. The brain calls MCP read tools to investigate, optionally calls
 *      `post_message` to surface items, and returns an updated MEMORY_LOG
 *      as its final assistant message.
 *   4. We compact-and-persist the new memory.
 *
 * Anti-burn: skip if `brainLastHeartbeatAt` was within `MIN_INTERVAL_MS`,
 * unless `force` is set. The Deep Researcher Agent paper (arXiv 2604.05854)
 * uses an exponential backoff up to 30 min for empty cycles; for V1 we
 * use a flat 5-minute floor as the cheapest guard.
 */

import { tmpdir } from "node:os";
import { prisma } from "@/lib/prisma";
import {
  callClaudeAgent,
  canUseToolForBrainHeartbeat,
} from "@/lib/ai/agentClient";
import { extractJson } from "@/lib/ai/client";
import { assembleMemory, saveMemoryLog } from "@/lib/brain/memory";
import { buildSciencedashSdkServer } from "@/lib/mcp/sdkServer";

const MIN_INTERVAL_MS = 5 * 60_000;

export type HeartbeatMode = "auto" | "propose";

export type HeartbeatResult =
  | {
      ok: true;
      jobId: string;
      skipped?: false;
      memoryLogChars: number;
      messagesPosted: number;
      costUsd: number | null;
      mode: HeartbeatMode;
    }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; jobId?: string; error: string };

export async function runHeartbeat(
  projectId: string,
  opts: { force?: boolean; mode?: HeartbeatMode } = {},
): Promise<HeartbeatResult> {
  const mode: HeartbeatMode = opts.mode ?? "auto";
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, brainLastHeartbeatAt: true },
  });
  if (!project) return { ok: false, error: "project not found" };

  if (!opts.force && project.brainLastHeartbeatAt) {
    const elapsed = Date.now() - project.brainLastHeartbeatAt.getTime();
    if (elapsed < MIN_INTERVAL_MS) {
      return {
        ok: true,
        skipped: true,
        reason: `last heartbeat was ${Math.round(elapsed / 1000)}s ago; min interval is ${MIN_INTERVAL_MS / 1000}s`,
      };
    }
  }

  const memory = await assembleMemory(projectId);
  const before = await countRecentAgentMessages(projectId);

  const job = await prisma.jobRun.create({
    data: {
      kind: "project_brain",
      title: `Brain heartbeat: ${project.title}`,
      projectId,
      startedAt: new Date(),
    },
  });

  // Tools run in-process (no HTTP MCP), so no token/url plumbing needed.

  // Build the user-content payload. We stuff the memory tiers in here as
  // markdown blocks; the system prompt tells Claude how to use them.
  const userContent = [
    `# Heartbeat for project ${projectId}`,
    "",
    "## Tier 1 — PROJECT_BRIEF (frozen, derived from DB)",
    "",
    memory.brief,
    "",
    "## Tier 2 — MEMORY_LOG (rolling, your previous entries)",
    "",
    memory.memoryLog || "(empty — this is the first cycle)",
    "",
    memory.humanDirective
      ? `## HUMAN_DIRECTIVE (consume once)\n\n${memory.humanDirective}`
      : "(no pending HUMAN_DIRECTIVE)",
    "",
    "Your final assistant message must be ONLY the new MEMORY_LOG markdown — see the system prompt's MEMORY_LOG hygiene section. The orchestrator persists it verbatim.",
  ].join("\n");

  const agent = await callClaudeAgent({
    jobId: job.id,
    promptName: "project-brain",
    userContent,
    cwd: tmpdir(),
    allowedTools: ["WebSearch", "WebFetch"],
    canUseTool: canUseToolForBrainHeartbeat(mode, ["arxiv.org"]),
    mcpServers: {
      sciencedash: buildSciencedashSdkServer(),
    },
    maxTurns: 20,
    wallClockMs: 6 * 60_000,
  });

  if (!agent.ok) {
    return { ok: false, jobId: job.id, error: agent.error ?? "agent session failed" };
  }

  // The brain's final message is the new memory log (markdown). It is NOT
  // JSON. If the brain accidentally wrote JSON, try to extract a "memoryLog"
  // field; otherwise treat the raw text as the log.
  const newLog = extractMemoryLogText(agent.resultText ?? "");
  const compacted = await saveMemoryLog(projectId, newLog);

  const after = await countRecentAgentMessages(projectId);
  const messagesPosted = Math.max(0, after - before);

  await prisma.jobRun
    .update({
      where: { id: job.id },
      data: {
        payloadJson: JSON.stringify({
          memoryLogCharsBefore: memory.memoryLog.length,
          memoryLogCharsAfter: compacted.length,
          humanDirectiveConsumed: !!memory.humanDirective,
          messagesPosted,
        }),
      },
    })
    .catch(() => null);

  return {
    ok: true,
    jobId: job.id,
    memoryLogChars: compacted.length,
    messagesPosted,
    costUsd: agent.costUsd,
    mode,
  };
}

function extractMemoryLogText(raw: string): string {
  const trimmed = raw.trim();
  // If the brain wrapped its output in JSON, try to pull memoryLog out.
  if (trimmed.startsWith("{")) {
    try {
      const parsed = extractJson<{ memoryLog?: string; memory_log?: string }>(trimmed);
      const m = parsed.memoryLog ?? parsed.memory_log;
      if (typeof m === "string") return m;
    } catch {
      // fall through
    }
  }
  // Strip leading/trailing markdown fences if present.
  return trimmed
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function countRecentAgentMessages(projectId: string): Promise<number> {
  return prisma.agentMessage.count({
    where: {
      projectId,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
  });
}
