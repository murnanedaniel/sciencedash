// Streaming wrapper around the Claude Agent SDK for multi-turn tool-using
// sessions. Parallels `callClaudeJson` in client.ts but persists every
// whitelisted message to `JobRun.messagesJson` as a JSONL log so a separate
// polling UI can render the agent's trace live.
//
// Keeps `callClaudeJson` untouched — that path is still single-shot JSON
// and used by critical-review / skeleton / polish / audit / literature.

import {
  query,
  type CanUseTool,
  type McpServerConfig,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { loadPromptPublic, type PromptName } from "@/lib/ai/client";

/* ----------------------------- types -------------------------------- */

export type TraceMessage = {
  /** Broad bucket for UI rendering. */
  kind: "assistant" | "user" | "system" | "result";
  /** ISO timestamp, server-side at persist time. */
  at: string;
  /** The narrow subtype from the SDK when relevant (e.g. "init", "success"). */
  subtype?: string;
  /** Rendered content blocks — shape depends on kind. */
  content?: unknown;
  /** For "result" only. */
  costUsd?: number | null;
  /** For "result" when subtype !== 'success'. */
  error?: string;
};

type CallAgentOptions = {
  jobId: string;
  promptName: PromptName;
  userContent: string;
  cwd: string;
  allowedTools: string[];
  canUseTool: CanUseTool;
  /** MCP server configs (e.g. { sciencedash: { type: "http", url: "..." } }). */
  mcpServers?: Record<string, McpServerConfig>;
  maxTurns?: number;
  wallClockMs?: number;
  /** External abort (e.g. user clicked Cancel). */
  abortSignal?: AbortSignal;
};

/* ----------------------- claude path resolver ----------------------- */

let cachedClaudePath: string | null | undefined;
async function resolveClaudePath(): Promise<string | null> {
  if (cachedClaudePath !== undefined) return cachedClaudePath;

  // First: `which claude` — honours whatever PATH the process has.
  const whichOut = await new Promise<string | null>((resolve) => {
    const proc = spawn("which", ["claude"], { timeout: 2000 });
    let buf = "";
    proc.stdout.on("data", (d) => (buf += d));
    proc.on("error", () => resolve(null));
    proc.on("close", () => resolve(buf.trim() ? buf.trim() : null));
  });
  if (whichOut) {
    cachedClaudePath = whichOut;
    return cachedClaudePath;
  }

  // Fallback: probe well-known install locations when PATH is thin
  // (the in-process worker + HMR dev servers often don't inherit
  // ~/.local/bin from the user's interactive shell).
  const { access, constants } = await import("node:fs/promises");
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

/* ---------------------- whitelist + truncation ---------------------- */

const MAX_CONTENT_BYTES = 16 * 1024;

function truncate(v: unknown): unknown {
  if (typeof v === "string") {
    return v.length > MAX_CONTENT_BYTES
      ? v.slice(0, MAX_CONTENT_BYTES) + "\n… [truncated]"
      : v;
  }
  if (Array.isArray(v)) {
    return v.map(truncate);
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = truncate(val);
    }
    return out;
  }
  return v;
}

/**
 * Convert an SDK message to a compact TraceMessage for persistence, or
 * return null to drop it. The filter keeps the log navigable: we keep
 * assistant turns, tool_result user turns, a handful of system messages,
 * and the final result. Everything else (stream_event, tool_progress,
 * hook_*, task_*, rate_limit_event, auth_status, mirror_error, keepalive)
 * is dropped.
 */
function shapeForPersist(msg: {
  type: string;
  subtype?: string;
  [k: string]: unknown;
}): TraceMessage | null {
  const at = new Date().toISOString();
  switch (msg.type) {
    case "assistant": {
      const m = msg as { message?: { content?: unknown } };
      return {
        kind: "assistant",
        at,
        content: truncate(m.message?.content ?? null),
      };
    }
    case "user": {
      // Only keep tool_result user messages — regular user messages are
      // what WE sent, no need to echo them to the log.
      const m = msg as { message?: { content?: Array<{ type?: string }> } };
      const content = Array.isArray(m.message?.content)
        ? m.message!.content.filter((b) => b.type === "tool_result")
        : [];
      if (content.length === 0) return null;
      return { kind: "user", at, content: truncate(content) };
    }
    case "system": {
      // Keep init and a few other headline subtypes; drop noise like
      // auth_status / api_retry / status / session_state_changed.
      if (msg.subtype === "init" || msg.subtype === "compact_boundary" ||
          msg.subtype === "notification") {
        return {
          kind: "system",
          at,
          subtype: msg.subtype,
          content: truncate(msg),
        };
      }
      return null;
    }
    case "result": {
      const m = msg as {
        subtype?: string;
        total_cost_usd?: number;
        errors?: string[];
        result?: string;
      };
      return {
        kind: "result",
        at,
        subtype: m.subtype,
        costUsd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : null,
        error: m.subtype !== "success"
          ? (m.errors ?? []).join("; ") || m.subtype || "unknown"
          : undefined,
        content: truncate({ result: m.result ?? null }),
      };
    }
    default:
      return null;
  }
}

/* ---------------------- debounced DB batcher ------------------------ */

/** Append lines to JobRun.messagesJson in 500ms batches to avoid thrash. */
class MessageBatcher {
  private buf: TraceMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private done = false;

  constructor(private readonly jobId: string) {}

  push(msg: TraceMessage) {
    this.buf.push(msg);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 500);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.buf.length === 0) return;
    this.flushing = true;
    const batch = this.buf;
    this.buf = [];
    try {
      const appended = batch.map((m) => JSON.stringify(m)).join("\n") + "\n";
      const current = await prisma.jobRun.findUnique({
        where: { id: this.jobId },
        select: { messagesJson: true },
      });
      const prior = current?.messagesJson ?? "";
      await prisma.jobRun.update({
        where: { id: this.jobId },
        data: { messagesJson: prior + appended },
      });
    } finally {
      this.flushing = false;
      // If new messages came in during the flush, schedule another.
      if (this.buf.length && !this.timer && !this.done) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, 500);
      }
    }
  }

  async close(): Promise<void> {
    this.done = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

/* --------------------------- main entry ----------------------------- */

/**
 * Stream a Claude Agent SDK session into the JobRun row. Persists
 * whitelisted messages to messagesJson as they arrive. Writes endedAt /
 * ok / costUsd / error on completion.
 *
 * Throws if the session fails to start. A failed run (model error,
 * max_turns, aborted) still resolves normally — the caller inspects the
 * returned `ok` flag (and/or the JobRun row's `ok` field).
 */
export async function callClaudeAgent(
  opts: CallAgentOptions,
): Promise<{
  ok: boolean;
  costUsd: number | null;
  error: string | null;
  resultText: string | null;
}> {
  const {
    jobId,
    promptName,
    userContent,
    cwd,
    allowedTools,
    canUseTool,
    mcpServers,
    maxTurns = 30,
    wallClockMs = 5 * 60_000,
    abortSignal,
  } = opts;

  const systemPrompt = await loadPromptPublic(promptName);
  const claudePath = await resolveClaudePath();
  const batcher = new MessageBatcher(jobId);

  // Compose an AbortController that trips on either the caller's signal or
  // our own wall-clock timeout.
  const ac = new AbortController();
  const wallClockTimer = setTimeout(() => {
    ac.abort(new Error("wall-clock timeout"));
  }, wallClockMs);
  if (abortSignal) {
    if (abortSignal.aborted) ac.abort(abortSignal.reason);
    else abortSignal.addEventListener("abort", () => ac.abort(abortSignal.reason), { once: true });
  }

  let finalOk = false;
  let finalCost: number | null = null;
  let finalError: string | null = null;
  let finalResultText: string | null = null;

  try {
    const q = query({
      prompt: userContent,
      options: {
        systemPrompt,
        model: "claude-opus-4-7",
        cwd,
        tools: allowedTools,
        canUseTool,
        ...(mcpServers ? { mcpServers } : {}),
        maxTurns,
        settingSources: [],
        abortController: ac,
        ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        env: {
          ...process.env,
          CLAUDE_AGENT_SDK_CLIENT_APP: "sciencedash/0.1-agent",
        },
      },
    });

    for await (const msg of q) {
      const raw = msg as {
        type: string;
        subtype?: string;
        result?: string;
      };
      const shaped = shapeForPersist(raw);
      if (shaped) batcher.push(shaped);
      if (shaped?.kind === "result") {
        finalCost = shaped.costUsd ?? null;
        // Capture the untruncated result text from the raw message — the
        // shaped copy may have been truncated for trace persistence, which
        // would break JSON parsing downstream.
        if (typeof raw.result === "string") finalResultText = raw.result;
        if (shaped.subtype === "success") {
          finalOk = true;
        } else {
          finalError = shaped.error ?? shaped.subtype ?? "failed";
        }
        break;
      }
    }
  } catch (e) {
    finalError =
      e instanceof Error ? e.message : String(e ?? "unknown agent error");
    batcher.push({
      kind: "result",
      at: new Date().toISOString(),
      subtype: "error_during_execution",
      error: finalError,
    });
  } finally {
    clearTimeout(wallClockTimer);
    await batcher.close();
    await prisma.jobRun.update({
      where: { id: jobId },
      data: {
        ok: finalOk,
        error: finalError ? finalError.slice(0, 1000) : null,
        endedAt: new Date(),
        costUsd: finalCost,
      },
    });
  }
  return {
    ok: finalOk,
    costUsd: finalCost,
    error: finalError,
    resultText: finalResultText,
  };
}

/**
 * canUseTool factory for research-style sessions: allow `WebSearch`
 * unconditionally; allow `WebFetch` only when the target URL is on one
 * of the configured hostnames (suffix match). Denies every other tool
 * outright. Intentionally NOT a file-path scoper — `cwd` is `tmpdir()`
 * and no file tools are in the allowlist for this kind of session.
 */
export function canUseToolForWebResearch(
  allowedHosts: string[],
): CanUseTool {
  const hosts = allowedHosts.map((h) => h.toLowerCase());
  return async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    if (toolName === "WebSearch") return { behavior: "allow", updatedInput: input };
    if (toolName === "WebFetch") {
      const url = typeof input.url === "string" ? input.url : "";
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        const ok = hosts.some(
          (h) => host === h || host.endsWith("." + h),
        );
        if (ok) return { behavior: "allow", updatedInput: input };
        return {
          behavior: "deny",
          message: `WebFetch host ${host} is not in the allowlist (${hosts.join(", ")})`,
        };
      } catch {
        return { behavior: "deny", message: `WebFetch got a non-URL input: ${url}` };
      }
    }
    return {
      behavior: "deny",
      message: `tool ${toolName} is not allowed in this session`,
    };
  };
}

/**
 * canUseTool factory for review-style sessions: allows any
 * `mcp__<server>__*` tool unconditionally (the MCP server itself is
 * trusted), `WebSearch` unconditionally, and `WebFetch` only on
 * allowlisted hostnames. Denies every other tool.
 */
export function canUseToolForReview(
  allowedHosts: string[],
  trustedMcpServers: string[] = ["sciencedash"],
): CanUseTool {
  const hosts = allowedHosts.map((h) => h.toLowerCase());
  const mcpPrefixes = trustedMcpServers.map((s) => `mcp__${s}__`);
  return async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    if (mcpPrefixes.some((p) => toolName.startsWith(p))) {
      return { behavior: "allow", updatedInput: input };
    }
    if (toolName === "WebSearch") return { behavior: "allow", updatedInput: input };
    if (toolName === "WebFetch") {
      const url = typeof input.url === "string" ? input.url : "";
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        const ok = hosts.some(
          (h) => host === h || host.endsWith("." + h),
        );
        if (ok) return { behavior: "allow", updatedInput: input };
        return {
          behavior: "deny",
          message: `WebFetch host ${host} not in allowlist`,
        };
      } catch {
        return { behavior: "deny", message: `WebFetch got non-URL: ${url}` };
      }
    }
    return {
      behavior: "deny",
      message: `tool ${toolName} not allowed in this session`,
    };
  };
}

/**
 * canUseTool factory: allow tool calls only when every file-path argument
 * resolves to a location INSIDE the given working-copy root. Catches `..`
 * traversal, absolute paths outside the root, and any other escape
 * attempt before the tool fires.
 *
 * Returns a `PermissionResult` per the SDK contract.
 */
export function canUseToolScopedToCwd(rootAbs: string): CanUseTool {
  const { resolve } = require("node:path") as typeof import("node:path");
  const normalizedRoot = resolve(rootAbs);

  return async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    // Extract every plausible path-like argument. Claude Code's file tools
    // name these fields `file_path` or `path`; Glob uses `path` as well.
    const candidates: Array<{ key: string; value: string }> = [];
    for (const k of ["file_path", "path", "filePath"]) {
      const v = input[k];
      if (typeof v === "string") candidates.push({ key: k, value: v });
    }
    for (const { key, value } of candidates) {
      const abs = resolve(normalizedRoot, value);
      if (
        abs !== normalizedRoot &&
        !abs.startsWith(normalizedRoot + "/")
      ) {
        return {
          behavior: "deny",
          message: `file path is outside the repo working copy (${normalizedRoot}); refusing ${toolName}(${key}=${JSON.stringify(value)})`,
        };
      }
    }
    return { behavior: "allow", updatedInput: input };
  };
}

/** Convenience: `tmpdir()/sciencedash-repo-<jobId>/`. */
export function jobTmpDir(jobId: string): string {
  const { join } = require("node:path") as typeof import("node:path");
  return join(tmpdir(), `sciencedash-repo-${jobId}`);
}
