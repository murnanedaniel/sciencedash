/**
 * Tool registry core — the transport-agnostic heart of ScienceDash's tools.
 *
 * `callTool(name, args)` dispatches to one of the registered handlers and
 * returns a `ToolResult` (= MCP CallToolResult shape). Consumers reach it
 * three ways, all in-process: the REST gateway (/api/tool/[name]), the
 * in-process SDK tool server (sdkServer.ts), and the workhorse sync
 * endpoints. The old JSON-RPC-over-HTTP transport has been retired.
 *
 * Tools are registered by importing their group modules; this keeps the
 * surface auditable (every tool is a static reference, not a runtime registration).
 */

import {
  type ToolDefinition,
  type ToolResult,
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
