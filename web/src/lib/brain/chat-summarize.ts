/**
 * Brain-chat summarisation sweep — invoked at the tail of the global
 * heartbeat. Finds BrainChat rows with no `summaryMd` yet, asks Claude
 * to compress each transcript into 3–6 bullets, and persists the result.
 *
 * The summary becomes part of the next chat session's CHAT_CONTEXT.md
 * primer, so the user gets continuity across sessions without having
 * to re-explain context every time.
 */

import { prisma } from "@/lib/prisma";
import { callClaudeText } from "@/lib/ai/client";

const SYSTEM_PROMPT = `You are summarising a chat between a user and the
ScienceDash global brain advisor. The user runs ScienceDash to coordinate
their research portfolio and uses these chats to think out loud, decide
what's next, and update project state.

Your output is plain markdown — 3 to 6 bullets covering:
- decisions made (what the user decided to do, or asked the brain to do)
- open questions (anything the user explicitly flagged as unresolved)
- state changes (any project / hypothesis / blocker fields the brain wrote
  via MCP tools during the chat — note these so the next session knows)

Be terse and decision-shaped. Don't pad with caveats. If a section has
nothing to say, omit it entirely. Do not wrap your output in a code fence.
Do not include a preamble or sign-off — bullets only.`;

/**
 * Summarise one BrainChat row. Returns the summary text + cost. Throws
 * on Claude SDK failure — the caller logs and moves on to the next chat.
 */
export async function summariseBrainChat(args: {
  title: string;
  transcriptMd: string;
}): Promise<{ summaryMd: string; costUsd: number | null }> {
  const userContent = [
    `# Chat title: ${args.title}`,
    "",
    "## Transcript",
    "",
    args.transcriptMd,
  ].join("\n");

  const { text, costUsd } = await callClaudeText({
    systemPrompt: SYSTEM_PROMPT,
    userContent,
  });

  return { summaryMd: text.trim(), costUsd };
}

/**
 * Find brain chats lacking a summary and fill them in. Best-effort —
 * one failed summary doesn't block the rest. Returns counts so the
 * caller can log them onto its JobRun payload.
 */
export async function summariseUnsummarisedBrainChats(opts: {
  maxPerSweep?: number;
} = {}): Promise<{ summarised: number; failed: number; totalCostUsd: number }> {
  const max = opts.maxPerSweep ?? 5;
  const pending = await prisma.brainChat.findMany({
    where: { summaryMd: null },
    orderBy: { createdAt: "asc" },
    take: max,
    select: { id: true, title: true, transcriptMd: true },
  });

  let summarised = 0;
  let failed = 0;
  let totalCostUsd = 0;

  for (const chat of pending) {
    try {
      const { summaryMd, costUsd } = await summariseBrainChat({
        title: chat.title,
        transcriptMd: chat.transcriptMd,
      });
      await prisma.brainChat.update({
        where: { id: chat.id },
        data: { summaryMd, summarizedAt: new Date() },
      });
      summarised++;
      if (typeof costUsd === "number") totalCostUsd += costUsd;
    } catch (e) {
      failed++;
      console.error(
        `summariseBrainChat failed for ${chat.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return { summarised, failed, totalCostUsd };
}
