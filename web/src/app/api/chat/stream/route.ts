/**
 * /api/chat/stream — server-sent events for the dashboard's chat surface.
 *
 * One POST per user turn. Each turn:
 *   1. Compose a system prompt with project state + user_brief.md.
 *   2. Spawn (or resume) a Claude Agent SDK session.
 *   3. Stream the SDK's message events back as SSE so the page can
 *      render assistant deltas, tool calls, tool results, and the final
 *      cost line as they arrive.
 *
 * Multi-turn shape: the first turn returns `{ kind: "session", sessionId }`
 * as one of the early SSE events. The client persists it and sends it back
 * as `body.sessionId` on subsequent turns; the SDK then `resume`s the same
 * subprocess-side session so the model has its prior turns in context.
 *
 * Auth: gated by the proxy (bearer or cookie). MCP server config carries
 * the bearer token so the spawned subprocess can call /api/mcp.
 */

import { NextRequest } from "next/server";
import { tmpdir } from "node:os";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  query,
  type CanUseTool,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { buildChatSystemPrompt } from "@/lib/chat/system-prompt";
import { buildMcpServerConfig } from "@/lib/brain/mcp-client";
import { resolveDashboardOrigin } from "@/lib/brain/dashboard-origin";
import { resolveClaudePath } from "@/lib/ai/agentClient";

export const dynamic = "force-dynamic";
// SDK session resumption is the multi-turn primitive — the route is
// stateless across the wire, the SDK keeps the conversation tape.
export const maxDuration = 300;

type ChatStreamRequest = {
  message?: string;
  sessionId?: string;
};

/**
 * Whitelist of tools the chat is allowed to call. All the ScienceDash
 * MCP write tools are wired in by name. Bash/Read/Write/Edit are
 * available so the chat can actually look at local repos when asked
 * (and edit files when the user wants).
 *
 * Notably present: `mcp__sciencedash__dispatch_workhorse_session` — the
 * user's "auto + kill switch" autonomy posture means the chat fires
 * this without asking.
 */
const ALLOWED_TOOLS = [
  // Read tools (read-only — safe everywhere)
  "mcp__sciencedash__query_entity",
  "mcp__sciencedash__get_entity",
  // Write tools (intent-named, hand-crafted)
  "mcp__sciencedash__create_project",
  "mcp__sciencedash__create_programme",
  "mcp__sciencedash__create_hypothesis",
  "mcp__sciencedash__create_paper",
  "mcp__sciencedash__create_metric_definition",
  "mcp__sciencedash__create_check_in",
  "mcp__sciencedash__record_decision",
  "mcp__sciencedash__add_note",
  "mcp__sciencedash__update_entity",
  "mcp__sciencedash__update_hypothesis_status",
  "mcp__sciencedash__move_run_to_hypothesis",
  "mcp__sciencedash__set_project_blocker",
  "mcp__sciencedash__post_message",
  "mcp__sciencedash__mark_message_read",
  "mcp__sciencedash__queue_directive",
  "mcp__sciencedash__dispatch_workhorse",
  "mcp__sciencedash__dispatch_workhorse_session",
  "mcp__sciencedash__stop_all_workhorses",
  "mcp__sciencedash__remove_workhorse",
  "mcp__sciencedash__attach_project_to_programme",
  "mcp__sciencedash__refresh_repo",
  "mcp__sciencedash__submit_brain_chat",
  // Workspace tools (the user expects the chat to look at things on
  // disk and edit files when asked).
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
];

/**
 * Auto-allow every tool the route's whitelist already names. The user's
 * "auto + kill switch" autonomy posture means we don't gate tool calls
 * mid-turn — anything dangerous gets walked back via /settings rather
 * than blocked at execution time.
 */
const ALLOWED_TOOLS_SET = new Set(ALLOWED_TOOLS);
const canUseChatTool: CanUseTool = async (
  toolName: string,
  input: Record<string, unknown>,
): Promise<PermissionResult> => {
  if (ALLOWED_TOOLS_SET.has(toolName)) {
    return { behavior: "allow", updatedInput: input };
  }
  // Allow any mcp__sciencedash__* tool not explicitly listed too —
  // future tools added to the MCP server should Just Work in chat
  // without redeploying this route.
  if (toolName.startsWith("mcp__sciencedash__")) {
    return { behavior: "allow", updatedInput: input };
  }
  return {
    behavior: "deny",
    message: `tool ${toolName} not in chat surface allowlist`,
  };
};

export async function POST(req: NextRequest) {
  let body: ChatStreamRequest;
  try {
    body = (await req.json()) as ChatStreamRequest;
  } catch {
    return jsonError(400, "invalid JSON");
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : undefined;
  if (!message) {
    return jsonError(400, "message is required");
  }

  const token = process.env.SCIENCEDASH_AUTH_TOKEN;
  if (!token) {
    return jsonError(500, "SCIENCEDASH_AUTH_TOKEN not set in server env");
  }
  const dashboardOrigin = await resolveDashboardOrigin();

  // Stable cwd across requests. The Claude Agent SDK derives session-
  // storage paths under `~/.claude/projects/<cwd-hash>/<sessionId>.jsonl`,
  // so a per-request fresh `mkdtemp` would put each turn in a different
  // bucket and `resume: <sessionId>` couldn't find the prior tape. One
  // shared cwd keeps every chat session under the same project dir;
  // sessions disambiguate by sessionId. Survives only as long as /tmp
  // does — acceptable for chat, no durability promise here.
  const cwd = join(tmpdir(), "sciencedash-chat");
  await mkdir(cwd, { recursive: true });

  const systemPrompt = await buildChatSystemPrompt();
  const mcpServerConfig = buildMcpServerConfig({
    dashboardUrl: dashboardOrigin,
    token,
  });
  // The SDK ships a Linux musl binary inside its node_modules; on the
  // homebox (and most dev machines) the user has their own `claude`
  // CLI installed elsewhere. Without an explicit pathToClaudeCodeExecutable
  // the SDK 404s on the bundled binary. Reuse the resolver agentClient
  // already trusts for the brain / heartbeats.
  const claudePath = await resolveClaudePath();

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        // SSE frame: each message is `event: <name>\ndata: <json>\n\n`.
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      };

      // If the client disconnects (closes the tab, navigates away), tear
      // down the SDK subprocess. Otherwise we'd leak claude processes.
      const onAbort = () => {
        try {
          ac.abort(new Error("client disconnected"));
        } catch {
          // ignore
        }
      };
      req.signal.addEventListener("abort", onAbort);

      try {
        const q = query({
          prompt: message,
          options: {
            systemPrompt,
            model: "claude-opus-4-7",
            cwd,
            tools: ALLOWED_TOOLS,
            canUseTool: canUseChatTool,
            mcpServers: { sciencedash: mcpServerConfig },
            // High maxTurns: the chat can chain many tool calls before
            // answering ("create project + dispatch workhorse + post a
            // confirmation message" is already 3 tool calls).
            maxTurns: 40,
            settingSources: [],
            abortController: ac,
            ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
            // Multi-turn: if the client supplied a sessionId from a
            // prior response, resume the SDK's stored conversation
            // tape rather than starting fresh.
            ...(sessionId ? { resume: sessionId } : {}),
            env: {
              ...process.env,
              CLAUDE_AGENT_SDK_CLIENT_APP: "sciencedash/0.1-chat",
            },
          },
        });

        for await (const msg of q) {
          // Forward SDK messages as-is — the client renders them. Strip
          // anything verbose where we can to keep the wire light, but the
          // SDK's payloads are already shaped for downstream consumers.
          const m = msg as {
            type: string;
            subtype?: string;
            session_id?: string;
            message?: { content?: unknown };
            result?: string;
            total_cost_usd?: number;
            is_error?: boolean;
          };

          if (m.type === "system" && m.subtype === "init" && m.session_id) {
            // Hand the sessionId back to the client immediately so it
            // can be used for the next turn.
            send("session", { sessionId: m.session_id });
            continue;
          }
          if (m.type === "assistant") {
            send("assistant", { content: m.message?.content ?? null });
            continue;
          }
          if (m.type === "user") {
            // The SDK echoes tool-result user messages back through this
            // channel. Surface them so the UI can render "tool foo returned
            // X" rows inline with the assistant's reasoning.
            const content = Array.isArray(m.message?.content)
              ? m.message!.content
              : [];
            const toolResults = content.filter(
              (b: unknown) =>
                typeof b === "object" &&
                b !== null &&
                (b as { type?: string }).type === "tool_result",
            );
            if (toolResults.length > 0) {
              send("tool_result", { content: toolResults });
            }
            continue;
          }
          if (m.type === "result") {
            send("result", {
              subtype: m.subtype ?? null,
              costUsd: m.total_cost_usd ?? null,
              text: m.result ?? null,
              isError: m.is_error === true,
            });
            // The result message terminates the SDK iterator naturally;
            // explicit break makes the loop intent obvious.
            break;
          }
          // Drop everything else (stream_event, keepalive, hook_*, etc.)
          // — too noisy for the wire and the UI doesn't render them.
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e ?? "unknown");
        send("error", { message: msg });
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        send("done", { ok: true });
        controller.close();
      }
    },
    cancel() {
      try {
        ac.abort(new Error("stream cancelled"));
      } catch {
        // ignore
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Disable proxy buffering — without this, nginx/cloudflared in
      // front of the dashboard would batch frames and lose the streaming
      // feel.
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
