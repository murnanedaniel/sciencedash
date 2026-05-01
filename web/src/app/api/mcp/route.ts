/**
 * MCP-over-HTTP transport for ScienceDash.
 *
 * Speaks JSON-RPC 2.0; supports `initialize`, `tools/list`, `tools/call`,
 * `ping`, plus the `notifications/initialized` no-op. Single-shot
 * request/response per POST. Streaming (SSE) can be added later if a
 * client needs incremental tool output; for now every tool returns
 * synchronously.
 *
 * Single-user local-first: no auth. If this ever gets exposed beyond
 * localhost / Tailscale, add a token check here.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleRpc } from "@/lib/mcp/server";
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  RPC_ERROR,
} from "@/lib/mcp/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Identify workhorse origin (if any) so direct MCP tool calls double as
  // claude_active heartbeats. Workhorses set this via the `headers` field
  // of their .mcp.json HTTP transport config.
  const workhorseId = req.headers.get("x-workhorse-id");
  if (workhorseId) {
    void recordClaudeBeat(workhorseId);
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch (e) {
    return rpcError(null, RPC_ERROR.PARSE_ERROR, e instanceof Error ? e.message : "invalid JSON");
  }

  // JSON-RPC 2.0 also allows batch requests (array of requests). Support it.
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return rpcError(null, RPC_ERROR.INVALID_REQUEST, "empty batch");
    }
    const responses = await Promise.all(parsed.map(safeHandle));
    const filtered = responses.filter((r): r is JsonRpcResponse => r !== null);
    if (filtered.length === 0) {
      // All notifications — JSON-RPC says no response.
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(filtered);
  }

  const single = await safeHandle(parsed);
  if (single === null) {
    // Notification — no response body.
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(single);
}

/** GET returns a tiny health page so a browser hit doesn't 405. */
export async function GET() {
  return NextResponse.json({
    server: "sciencedash-mcp",
    version: "0.1.0",
    transport: "http+json-rpc",
    hint: "POST a JSON-RPC 2.0 request: {jsonrpc:'2.0',id:1,method:'tools/list'}",
  });
}

async function safeHandle(raw: unknown): Promise<JsonRpcResponse | null> {
  if (!raw || typeof raw !== "object") {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: RPC_ERROR.INVALID_REQUEST, message: "request must be a JSON object" },
    };
  }
  try {
    return await handleRpc(raw as JsonRpcRequest);
  } catch (e) {
    const reqId = (raw as { id?: number | string | null }).id ?? null;
    return {
      jsonrpc: "2.0",
      id: reqId,
      error: {
        code: RPC_ERROR.INTERNAL_ERROR,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

function rpcError(id: number | string | null, code: number, message: string) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  } satisfies JsonRpcResponse);
}

/**
 * Record a claude_active heartbeat for a workhorse identified by the
 * `<host>:<sessionName>` workhorse-id header. Best-effort: if the row
 * doesn't exist we silently skip (workhorse must be registered via
 * /api/mcp/sync first).
 */
async function recordClaudeBeat(workhorseId: string): Promise<void> {
  const colonIdx = workhorseId.indexOf(":");
  if (colonIdx <= 0) return;
  const host = workhorseId.slice(0, colonIdx);
  const sessionName = workhorseId.slice(colonIdx + 1);
  const { prisma } = await import("@/lib/prisma");
  await prisma.workhorse
    .updateMany({
      where: { host, sessionName },
      data: { lastClaudeBeat: new Date() },
    })
    .catch(() => {
      /* not registered yet — ignore */
    });
}
