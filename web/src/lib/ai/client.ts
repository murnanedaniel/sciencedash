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
  | "outer-loop-audit"
  | "repo-quickstart"
  | "literature-review"
  | "project-brain";

const KIND_MAP: Record<PromptName, string> = {
  "critical-review": "critical_review",
  skeleton: "paper_skeleton",
  polish: "section_polish",
  "outer-loop-audit": "outer_loop_audit",
  "repo-quickstart": "repo_quickstart",
  "literature-review": "literature_review",
  "project-brain": "project_brain",
};

const FILE_MAP: Record<PromptName, string> = {
  "critical-review": "critical-review.md",
  skeleton: "skeleton.md",
  polish: "polish.md",
  "outer-loop-audit": "outer-loop-audit.md",
  "repo-quickstart": "repo-quickstart.md",
  "literature-review": "literature-review.md",
  "project-brain": "project-brain.md",
};

/** Re-exported so agent streaming code can use the same loader logic. */
export async function loadPromptPublic(name: PromptName): Promise<string> {
  return loadPrompt(name);
}

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
    // Synthesise a minimal trace so /jobs/<id> shows something useful even
    // for single-shot callClaudeJson paths (which don't stream). Expect
    // callClaudeJson's shape `{ parsed, rawText, costUsd }` but gracefully
    // skip if fn returns something else.
    const trace: string[] = [];
    let costUsd: number | null = null;
    if (out && typeof out === "object") {
      const r = out as { rawText?: unknown; costUsd?: unknown };
      if (typeof r.rawText === "string" && r.rawText.length > 0) {
        const truncated =
          r.rawText.length > 16 * 1024
            ? r.rawText.slice(0, 16 * 1024) + "\n… [truncated]"
            : r.rawText;
        trace.push(
          JSON.stringify({
            kind: "assistant",
            at: new Date().toISOString(),
            content: [{ type: "text", text: truncated }],
          }),
        );
      }
      if (typeof r.costUsd === "number") costUsd = r.costUsd;
    }
    trace.push(
      JSON.stringify({
        kind: "result",
        at: new Date().toISOString(),
        subtype: "success",
        costUsd,
      }),
    );
    await prisma.jobRun.update({
      where: { id: job.id },
      data: {
        ok: true,
        endedAt: new Date(),
        costUsd,
        messagesJson: trace.join("\n") + "\n",
      },
    });
    return { ok: true, out, jobId: job.id };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.update({
      where: { id: job.id },
      data: {
        ok: false,
        error: err.slice(0, 1000),
        endedAt: new Date(),
        messagesJson:
          JSON.stringify({
            kind: "result",
            at: new Date().toISOString(),
            subtype: "error_during_execution",
            error: err,
          }) + "\n",
      },
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
 * Single-shot Claude text completion with an inline system prompt. Same
 * Claude-CLI billing as `callClaudeJson`, but returns the raw assistant
 * text instead of a parsed JSON object. Use for tasks where the output
 * is markdown / prose, not a structured payload (e.g. chat summaries).
 */
export async function callClaudeText(args: {
  systemPrompt: string;
  userContent: string;
  model?: string;
}): Promise<{ text: string; costUsd: number | null }> {
  const claudePath = await resolveClaudePath();
  const q = query({
    prompt: args.userContent,
    options: {
      systemPrompt: args.systemPrompt,
      model: args.model ?? "claude-opus-4-7",
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

  return { text: resultText, costUsd };
}

/**
 * Extract the first balanced JSON object from model output. Models occasionally
 * add a markdown fence, leading prose, or a trailing explanation — we strip
 * both and walk the brace stack to pull just the object. As a last resort we
 * re-escape raw control characters inside quoted strings.
 */
export function extractJson<T>(raw: string): T {
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

  // If the walk hit EOF with open braces still on the stack, the model
  // almost certainly got cut off by the output-token limit. Try to
  // recover: walk back to the last complete-looking element, auto-close
  // the remaining braces/brackets, and parse that. Prefer recovery over
  // losing the whole payload.
  let recovered: string | null = null;
  if (end === -1) {
    recovered = recoverTruncatedJson(cleaned, start, depth, inString);
    if (!recovered) {
      throw new Error(
        `unterminated JSON object — first 200 chars: ${cleaned.slice(start, start + 200)}`,
      );
    }
  }

  const slice = recovered ?? cleaned.slice(start, end + 1);
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

/**
 * Best-effort reconstruction of a JSON object that was cut off mid-stream
 * by an output-token limit. Strategy: trim any partially-written key or
 * value from the tail, close any open string, then append the right
 * number of `]` / `}` to balance the stack. Returns null if we can't find
 * any reasonable trim point.
 *
 * Not a general JSON fixer — scoped to the specific failure mode where
 * the LLM's tail looks like "...", "rationale": "...truncated-string".
 */
function recoverTruncatedJson(
  cleaned: string,
  start: number,
  _depth: number,
  _inString: boolean,
): string | null {
  // Re-walk carrying the stack of open brackets. Track the position of
  // the last full top-level element so we can truncate there if needed.
  const stack: Array<"{" | "["> = [];
  let inStr = false;
  let esc = false;
  let i = start;
  let lastSafeClose = -1; // position of the most recent well-balanced closer
  for (; i < cleaned.length; i++) {
    const c = cleaned[i]!;
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c as "{" | "[");
    else if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length === 1) lastSafeClose = i;
    }
  }

  // Truncate to end-of-string: if we're mid-string, back up to the last
  // quote mark we had crossed (so we don't leave a dangling backslash).
  let trimEnd = cleaned.length;
  if (inStr) {
    // find position of last unescaped quote before EOF — simpler: just
    // close the string manually by appending `"`.
  }

  // Strip any trailing fragment after the last comma at the top level.
  // Common shape at truncation: `"rationale": "blah bl` — we want to
  // discard the partial key/value and close the object.
  let tail = cleaned.slice(start, trimEnd);

  // If there's an unterminated string, close it.
  let tmpInStr = false;
  let tmpEsc = false;
  for (let j = 0; j < tail.length; j++) {
    const c = tail[j]!;
    if (tmpEsc) { tmpEsc = false; continue; }
    if (c === "\\") { tmpEsc = true; continue; }
    if (c === '"') tmpInStr = !tmpInStr;
  }
  if (tmpInStr) tail += '"';

  // Drop trailing comma if present.
  tail = tail.replace(/,\s*$/, "");
  // Drop trailing `"someKey":` with no value.
  tail = tail.replace(/,\s*"[^"]*"\s*:\s*$/, "");

  // Close remaining open brackets/braces in reverse.
  while (stack.length > 0) {
    const open = stack.pop()!;
    tail += open === "{" ? "}" : "]";
  }

  // Sanity: if we made zero changes and the brace count still doesn't
  // balance, bail. Otherwise return the best-effort slice.
  let opens = 0;
  let closes = 0;
  let s2 = false;
  let e2 = false;
  for (let j = 0; j < tail.length; j++) {
    const c = tail[j]!;
    if (e2) { e2 = false; continue; }
    if (c === "\\") { e2 = true; continue; }
    if (c === '"') { s2 = !s2; continue; }
    if (s2) continue;
    if (c === "{" || c === "[") opens++;
    else if (c === "}" || c === "]") closes++;
  }
  if (opens !== closes) {
    // Fallback: if the balance is still wrong, try harder by truncating
    // to the last safe close and wrapping.
    if (lastSafeClose > 0) {
      return cleaned.slice(start, lastSafeClose + 1) + "}";
    }
    return null;
  }
  return tail;
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
  const { access, constants } = await import("node:fs/promises");

  // First: `which claude` — honours whatever PATH the process has.
  const whichOut: string = await new Promise((resolve) => {
    const proc = spawn("which", ["claude"], { timeout: 2000 });
    let buf = "";
    proc.stdout.on("data", (d) => (buf += d));
    proc.on("error", () => resolve(""));
    proc.on("close", () => resolve(buf.trim()));
  });
  if (whichOut) {
    cachedClaudePath = whichOut;
    return cachedClaudePath;
  }

  // Fallback: probe well-known install locations when PATH is thin
  // (the in-process worker and HMR dev servers often don't inherit
  // ~/.local/bin from the user's interactive shell).
  const home = process.env.HOME ?? "";
  const candidates = [
    home ? `${home}/.local/bin/claude` : "",
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      await access(c, constants.X_OK);
      cachedClaudePath = c;
      return cachedClaudePath;
    } catch {
      // try next
    }
  }
  cachedClaudePath = null;
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
