/**
 * In-process tool server for autonomous Agent-SDK runs (critical review, brain
 * heartbeat, dashboard chat). The successor to the HTTP MCP config: same 24
 * tools, same `callTool` core, but defined as SDK function-tools — no JSON-RPC
 * endpoint, no `.mcp.json`. Tools still surface as `mcp__sciencedash__<name>`,
 * so the existing `canUseTool*` allowlists keep these runs scoped.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z, type ZodTypeAny } from "zod";
import { listTools, callTool } from "@/lib/mcp/server";

type JsonSchema = {
  type?: string;
  enum?: string[];
  items?: JsonSchema;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

/** Convert one JSON-Schema property to a Zod type (the subset our tools use). */
function toZod(s: JsonSchema): ZodTypeAny {
  let base: ZodTypeAny;
  if (s.enum && s.enum.length) {
    base = z.enum(s.enum as [string, ...string[]]);
  } else {
    switch (s.type) {
      case "string":
        base = z.string();
        break;
      case "number":
      case "integer":
        base = z.number();
        break;
      case "boolean":
        base = z.boolean();
        break;
      case "array":
        base = z.array(s.items ? toZod(s.items) : z.any());
        break;
      case "object":
        base = z.record(z.string(), z.any());
        break;
      default:
        base = z.any();
    }
  }
  return s.description ? base.describe(s.description) : base;
}

/** JSON-Schema object -> Zod raw shape (required props stay, others .optional()). */
function toShape(schema: JsonSchema | undefined): Record<string, ZodTypeAny> {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};
  for (const [k, v] of Object.entries(props)) {
    const t = toZod(v);
    shape[k] = required.has(k) ? t : t.optional();
  }
  return shape;
}

/** Build the in-process "sciencedash" tool server from the shared registry. */
export function buildSciencedashSdkServer() {
  const tools = listTools().map((d) =>
    tool(
      d.name,
      d.description,
      toShape(d.inputSchema as JsonSchema),
      // Our ToolResult is already the MCP CallToolResult shape — pass through.
      async (args: Record<string, unknown>) =>
        (await callTool(d.name, args ?? {})) as Awaited<
          ReturnType<Parameters<typeof tool>[3]>
        >,
    ),
  );
  return createSdkMcpServer({ name: "sciencedash", version: "0.1.0", tools });
}
