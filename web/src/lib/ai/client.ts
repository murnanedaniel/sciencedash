import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import type { JobKind } from "@/generated/prisma/client";

const PROMPT_DIR = join(process.cwd(), "src", "lib", "ai", "prompts");

export type PromptName =
  | "critical-review"
  | "skeleton"
  | "polish"
  | "outer-loop-audit";

async function loadPrompt(name: PromptName): Promise<string> {
  // Prompt templates in the DB override the on-disk default.
  const kindMap: Record<PromptName, string> = {
    "critical-review": "critical_review",
    skeleton: "paper_skeleton",
    polish: "section_polish",
    "outer-loop-audit": "outer_loop_audit",
  };
  const row = await prisma.promptTemplate.findUnique({
    where: { kind: kindMap[name] as never },
  });
  if (row) return row.bodyMd;
  const p = await readFile(join(PROMPT_DIR, `${name}.md`), "utf8");
  return p;
}

function anthropic(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey: key });
}

/** Wrap every AI call in a JobRun row so spend is visible on /settings. */
export async function runAi<T>(
  kind: JobKind,
  projectId: string | null,
  fn: () => Promise<T>,
): Promise<{ ok: true; out: T; jobId: string } | { ok: false; error: string; jobId: string }> {
  const job = await prisma.jobRun.create({
    data: { kind, projectId: projectId ?? null, startedAt: new Date() },
  });
  try {
    const out = await fn();
    await prisma.jobRun.update({
      where: { id: job.id },
      data: { ok: true, endedAt: new Date() },
    });
    return { ok: true, out, jobId: job.id };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.update({
      where: { id: job.id },
      data: { ok: false, error: err.slice(0, 1000), endedAt: new Date() },
    });
    return { ok: false, error: err, jobId: job.id };
  }
}

export async function callClaudeJson<T>(
  promptName: PromptName,
  userContent: string,
  opts: { cacheSystem?: boolean } = {},
): Promise<T> {
  const client = anthropic();
  const system = await loadPrompt(promptName);
  const resp = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    system: opts.cacheSystem
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : system,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = resp.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) throw new Error("no text block in response");

  // Be forgiving of stray code fences even though the prompt forbids them.
  const stripped = textBlock.text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(stripped) as T;
}
