/**
 * Codex forum participant — OpenAI Codex CLI, driven as a subprocess.
 *
 * Transport: `codex exec --json` writes one JSON object per line to stdout
 * and keeps a resumable thread on disk. The shapes we consume:
 *
 *   {"type":"thread.started","thread_id":"01a0…"}   <- the resume handle
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"item_type":"agent_message","text":…}}
 *   {"type":"turn.completed","usage":{…}}
 *   {"type":"turn.failed","error":{"message":…}}
 *   {"type":"error","message":…}
 *
 * Two robustness decisions worth knowing:
 *
 *  - **`-o <file>` is the source of truth for the final answer**, not the
 *    parsed `agent_message` items. The event vocabulary is young and may
 *    drift between CLI versions; the last-message file is a stable contract.
 *    Events drive the live UI; the file decides what gets relayed.
 *  - **stdin is closed.** Without a TTY, `codex exec` blocks forever waiting
 *    to append piped stdin to the prompt. This is the single most common way
 *    to hang a headless codex run.
 *
 * There is no config key for a system prompt (`base_instructions` is not a
 * valid `-c` override), so forum instructions are prepended to the prompt
 * text on the opening turn; resumed turns already carry them in-thread.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexBin } from "@/lib/config";
import type {
  DriverContext,
  ForumTurnEvent,
  ForumTurnResult,
  ParticipantDriver,
} from "@/lib/forum/types";

/** Read-only sandbox: a forum discusses, it does not edit the workspace. */
const SANDBOX = "read-only";

type CodexEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: Record<string, unknown>;
  usage?: Record<string, unknown>;
};

/**
 * Map one codex event to forum events. Tolerant by design: unknown item
 * kinds are dropped rather than rendered as noise, and both `item_type` and
 * `type` are accepted as the item discriminator since the CLI has used both.
 */
function mapEvent(ev: CodexEvent): ForumTurnEvent[] {
  if (ev.type === "error" && ev.message) {
    return [{ kind: "error", message: ev.message }];
  }
  if (ev.type === "turn.failed") {
    return [{ kind: "error", message: ev.error?.message ?? "turn failed" }];
  }
  if (ev.type !== "item.completed" || !ev.item) return [];

  const item = ev.item;
  const kind =
    (typeof item.item_type === "string" && item.item_type) ||
    (typeof item.type === "string" && item.type) ||
    "";
  const text = typeof item.text === "string" ? item.text : "";

  switch (kind) {
    case "agent_message":
      return text ? [{ kind: "text", text }] : [];
    case "reasoning":
      return text ? [{ kind: "reasoning", text }] : [];
    case "command_execution": {
      const command =
        typeof item.command === "string" ? item.command : String(item.command ?? "");
      const exitCode = typeof item.exit_code === "number" ? item.exit_code : 0;
      return [
        { kind: "tool_use", name: "shell", input: { command } },
        {
          kind: "tool_result",
          name: "shell",
          content: item.aggregated_output ?? "",
          isError: exitCode !== 0,
        },
      ];
    }
    case "web_search":
      return [
        { kind: "tool_use", name: "web_search", input: { query: item.query ?? text } },
      ];
    case "mcp_tool_call":
      return [
        {
          kind: "tool_use",
          name: typeof item.tool === "string" ? item.tool : "mcp_tool_call",
          input: item.arguments ?? null,
        },
      ];
    case "file_change":
      return [{ kind: "tool_use", name: "file_change", input: item.changes ?? null }];
    default:
      return [];
  }
}

export const codexDriver: ParticipantDriver = {
  id: "codex",

  async speak(prompt: string, ctx: DriverContext): Promise<ForumTurnResult> {
    const events: ForumTurnEvent[] = [];
    const push = (e: ForumTurnEvent) => {
      events.push(e);
      ctx.onEvent(e);
    };

    const streamedText: string[] = [];
    let sessionRef: string | null = ctx.sessionRef;
    let error: string | null = null;

    // Codex has no system-prompt flag; fold the instructions into the opening
    // turn. A resumed thread already has them.
    const fullPrompt = ctx.sessionRef
      ? prompt
      : `${ctx.systemPrompt}\n\n---\n\n${prompt}`;

    const outDir = join(tmpdir(), "sciencedash-forum-codex");
    await mkdir(outDir, { recursive: true });
    const lastMessageFile = join(outDir, `${randomUUID()}.txt`);

    // Arg order matters and is not symmetric: every option belongs to `exec`,
    // BEFORE the `resume` subcommand. Putting them after the session id fails
    // with "unexpected argument '-s' found" — `resume` accepts only
    // [SESSION_ID] [PROMPT] plus its own small flag set.
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-s",
      SANDBOX,
      "-m",
      ctx.model,
      // Research surface: the forum is for reading and reasoning, and web
      // search is the main thing Codex brings that a local read can't.
      "-c",
      "tools.web_search=true",
      "-o",
      lastMessageFile,
    ];
    if (ctx.sessionRef) args.push("resume", ctx.sessionRef);
    args.push(fullPrompt);

    try {
      const exitInfo = await new Promise<{ code: number | null; stderr: string }>(
        (resolve) => {
          const child = spawn(codexBin(), args, {
            cwd: ctx.cwd,
            // stdin closed: codex otherwise blocks forever trying to read a
            // piped prompt when there's no TTY.
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env },
          });

          let stdoutBuf = "";
          let stderrBuf = "";
          let settled = false;

          const onAbort = () => {
            try {
              child.kill("SIGTERM");
            } catch {
              // already gone
            }
          };
          if (ctx.signal.aborted) onAbort();
          else ctx.signal.addEventListener("abort", onAbort, { once: true });

          const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            ctx.signal.removeEventListener("abort", onAbort);
            resolve({ code, stderr: stderrBuf });
          };

          child.stdout.on("data", (chunk: Buffer) => {
            stdoutBuf += chunk.toString("utf-8");
            let nl: number;
            while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
              const line = stdoutBuf.slice(0, nl).trim();
              stdoutBuf = stdoutBuf.slice(nl + 1);
              if (!line || !line.startsWith("{")) continue;
              let ev: CodexEvent;
              try {
                ev = JSON.parse(line) as CodexEvent;
              } catch {
                continue;
              }
              if (ev.type === "thread.started" && ev.thread_id) {
                sessionRef = ev.thread_id;
                continue;
              }
              for (const mapped of mapEvent(ev)) {
                if (mapped.kind === "text") streamedText.push(mapped.text);
                if (mapped.kind === "error") error = mapped.message;
                push(mapped);
              }
            }
          });

          // Codex logs progress to stderr; keep a bounded tail for diagnosis.
          child.stderr.on("data", (chunk: Buffer) => {
            stderrBuf = (stderrBuf + chunk.toString("utf-8")).slice(-4000);
          });

          child.on("error", (e) => {
            error = `failed to spawn ${codexBin()}: ${e.message}`;
            finish(null);
          });
          child.on("close", (code) => finish(code));
        },
      );

      // The last-message file is authoritative; fall back to whatever text
      // the event stream produced if it's missing (older CLI, killed run).
      let finalText = "";
      try {
        finalText = (await readFile(lastMessageFile, "utf-8")).trim();
      } catch {
        finalText = streamedText.join("\n").trim();
      }

      if (exitInfo.code !== 0 && !error) {
        error =
          exitInfo.stderr.trim().split("\n").slice(-3).join(" ").trim() ||
          `codex exited with code ${exitInfo.code}`;
      }

      return {
        text: finalText || streamedText.join("\n").trim(),
        sessionRef,
        // `codex exec` reports token usage, not dollars. Leaving this null is
        // honest: the forum's cost line shouldn't imply Codex turns are free.
        costUsd: null,
        events,
        error,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e ?? "unknown");
      push({ kind: "error", message });
      return {
        text: streamedText.join("\n").trim(),
        sessionRef,
        costUsd: null,
        events,
        error: message,
      };
    } finally {
      await rm(lastMessageFile, { force: true }).catch(() => {});
    }
  },
};
