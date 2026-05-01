/**
 * MCP server core — tool registry + JSON-RPC dispatcher.
 *
 * Three methods supported: `initialize`, `tools/list`, `tools/call`.
 * Tools are registered by importing their group modules; this keeps the
 * surface auditable (every tool is a static reference, not a runtime registration).
 */

import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ToolDefinition,
  type ToolResult,
  RPC_ERROR,
} from "@/lib/mcp/types";
import { readTools } from "@/lib/mcp/tools/read";
import { writeTools } from "@/lib/mcp/tools/write";

/* ----------------------------- registry ----------------------------- */

const TOOLS: ToolDefinition[] = [...readTools, ...writeTools];

const TOOL_BY_NAME = new Map<string, ToolDefinition>(
  TOOLS.map((t) => [t.name, t]),
);

export function listTools(): Array<Pick<ToolDefinition, "name" | "description" | "inputSchema">> {
  return TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    return await tool.handler(args ?? {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: `tool ${name} threw: ${msg}` }],
      isError: true,
    };
  }
}

/* ----------------------------- dispatcher --------------------------- */

const SERVER_INFO = {
  protocolVersion: "2025-06-18",
  capabilities: {
    tools: { listChanged: false },
  },
  serverInfo: {
    name: "sciencedash-mcp",
    version: "0.1.0",
  },
};

export async function handleRpc(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  // Notifications (no id) get no response — fire-and-forget per JSON-RPC 2.0.
  const isNotification = req.id === undefined;

  if (req.jsonrpc !== "2.0") {
    if (isNotification) return null;
    return {
      jsonrpc: "2.0",
      id,
      error: { code: RPC_ERROR.INVALID_REQUEST, message: "expected jsonrpc: '2.0'" },
    };
  }

  switch (req.method) {
    case "initialize":
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, result: SERVER_INFO };

    case "notifications/initialized":
      // Client signalling readiness — no response required.
      return null;

    case "tools/list":
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, result: { tools: listTools() } };

    case "tools/call": {
      if (isNotification) return null;
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (typeof params.name !== "string") {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: RPC_ERROR.INVALID_PARAMS, message: "tools/call requires `name` (string)" },
        };
      }
      const result = await callTool(params.name, params.arguments ?? {});
      return { jsonrpc: "2.0", id, result };
    }

    case "ping":
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, result: {} };

    default:
      if (isNotification) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: RPC_ERROR.METHOD_NOT_FOUND, message: `unknown method: ${req.method}` },
      };
  }
}

/* ----------------------- helpers for tool authors ------------------- */

/**
 * Wrap a JSON-serialisable payload as a single-text-block tool result.
 *
 * We intentionally DON'T set `structuredContent` here: per the MCP spec
 * a server that returns structuredContent must also declare an output
 * schema, and arrays-as-top-level (which several list_* tools return)
 * trigger "expected record" validation errors in some clients. Plain
 * text is universally accepted; Claude parses our pretty-printed JSON
 * fine.
 */
export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap a plain string as a tool result (for prose answers). */
export function textResult(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}

/** Convenience: argument-not-string error. */
export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`required string argument missing: ${key}`);
  }
  return v;
}

export function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function optInt(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
}
