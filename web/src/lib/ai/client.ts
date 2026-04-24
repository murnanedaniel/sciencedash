import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "@/lib/prisma";
import type { JobKind } from "@/generated/prisma/client";

const PROMPT_DIR = join(process.cwd(), "src", "lib", "ai", "prompts");

export type PromptName =
  | "critical-review"
  | "skeleton"
  | "polish"
  | "outer-loop-audit";

const KIND_MAP: Record<PromptName, string> = {
  "critical-review": "critical_review",
  skeleton: "paper_skeleton",
  polish: "section_polish",
  "outer-loop-audit": "outer_loop_audit",
};

const FILE_MAP: Record<PromptName, string> = {
  "critical-review": "critical-review.md",
  skeleton: "skeleton.md",
  polish: "polish.md",
  "outer-loop-audit": "outer-loop-audit.md",
};

async function loadPrompt(name: PromptName): Promise<string> {
  const row = await prisma.promptTemplate.findUnique({
    where: { kind: KIND_MAP[name] as never },
  });
  if (row) return row.bodyMd;
  return readFile(join(PROMPT_DIR, FILE_MAP[name]), "utf8");
}

/** Wrap every AI call in a JobRun row so spend is visible on /settings. */
export async function runAi<T>(
  kind: JobKind,
  projectId: string | null,
  fn: () => Promise<T>,
): Promise<
  | { ok: true; out: T; jobId: string }
  | { ok: false; error: string; jobId: string }
> {
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

/**
 * Run one Claude call via the Claude Agent SDK. Authenticates through the
 * user's installed `claude` binary, so the call bills against their Pro/Max
 * subscription (not API credits).
 *
 * We disable all tools (`tools: []`), run in `os.tmpdir()` so the dashboard's
 * own CLAUDE.md / AGENTS.md / source files don't leak into the context, and
 * cap at one turn — every prompt in this repo is a single-shot JSON return.
 */
export async function callClaudeJson<T>(
  promptName: PromptName,
  userContent: string,
): Promise<{ parsed: T; rawText: string; costUsd: number | null }> {
  const systemPrompt = await loadPrompt(promptName);

  // Use the globally-installed `claude` binary (from `claude login`) rather
  // than the SDK's bundled native binary — so calls bill against whichever
  // account the user's CLI is signed into (typically a Pro/Max subscription).
  // Falls back to the SDK's default path if we can't resolve a global claude.
  const claudePath = await resolveClaudePath();

  const q = query({
    prompt: userContent,
    options: {
      systemPrompt,
      model: "claude-opus-4-7",
      cwd: tmpdir(),
      tools: [],
      maxTurns: 1,
      settingSources: [],
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "sciencedash/0.1" },
    },
  });

  let resultText: string | null = null;
  let costUsd: number | null = null;
  let errorText: string | null = null;

  for await (const msg of q) {
    if (msg.type === "result") {
      if (msg.subtype === "success") {
        resultText = msg.result;
        costUsd = msg.total_cost_usd;
      } else {
        errorText = `Claude Agent SDK: ${msg.subtype} (${(msg.errors ?? []).join("; ") || "no details"})`;
      }
      break;
    }
  }

  if (errorText) throw new Error(errorText);
  if (resultText == null)
    throw new Error("Claude Agent SDK returned no result message");

  const parsed = extractJson<T>(resultText);
  return { parsed, rawText: resultText, costUsd };
}

/**
 * Extract the first balanced JSON object from model output. Models occasionally
 * add a markdown fence, leading prose, or a trailing explanation — we strip
 * both and walk the brace stack to pull just the object. As a last resort we
 * re-escape raw control characters inside quoted strings.
 */
function extractJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) {
    throw new Error(
      `model returned no JSON object — first 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(
      `unterminated JSON object — first 200 chars: ${cleaned.slice(start, start + 200)}`,
    );
  }

  const slice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch (firstErr) {
    const defanged = escapeControlCharsInStrings(slice);
    try {
      return JSON.parse(defanged) as T;
    } catch {
      throw new Error(
        `model returned non-JSON output: ${(firstErr as Error).message} — first 200 chars: ${slice.slice(0, 200)}`,
      );
    }
  }
}

function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (const c of s) {
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      const code = c.charCodeAt(0);
      if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (code < 0x20)
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      else out += c;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Find a globally-installed `claude` binary. Checks common fnm / npm /
 * user-local paths, then falls back to `which claude`. Returns null if
 * nothing is found, letting the Agent SDK use its bundled fallback.
 */
let cachedClaudePath: string | null | undefined;
async function resolveClaudePath(): Promise<string | null> {
  if (cachedClaudePath !== undefined) return cachedClaudePath;
  const { spawn } = await import("node:child_process");
  const out: string = await new Promise((resolve) => {
    const proc = spawn("which", ["claude"], { timeout: 2000 });
    let buf = "";
    proc.stdout.on("data", (d) => (buf += d));
    proc.on("error", () => resolve(""));
    proc.on("close", () => resolve(buf.trim()));
  });
  cachedClaudePath = out || null;
  return cachedClaudePath;
}

/** Probe the installed Claude Code binary for Settings display. */
export async function detectClaudeCode(): Promise<{
  ok: boolean;
  version?: string;
  error?: string;
}> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { timeout: 4000 });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", (e) => resolve({ ok: false, error: e.message }));
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true, version: out.trim() });
      else resolve({ ok: false, error: `exit ${code}` });
    });
  });
}
