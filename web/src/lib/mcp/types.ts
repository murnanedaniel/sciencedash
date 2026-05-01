/**
 * Minimal MCP server types — JSON-RPC 2.0 wire format + tool definitions.
 *
 * We hand-roll a small subset of the MCP spec rather than pulling
 * `@modelcontextprotocol/sdk` because (a) we only need three methods
 * (initialize, tools/list, tools/call), (b) Next.js 16 route handlers
 * have their own ergonomics, and (c) every dep we add must justify itself.
 *
 * Spec reference: https://modelcontextprotocol.io/specification/
 */

export type JsonSchema = {
  type?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: readonly string[];
  description?: string;
  default?: unknown;
  format?: string;
};

export type ToolInputSchema = {
  type: "object";
  properties: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
  /** Optional structured payload (MCP 2025+); we mirror it for clients that prefer JSON. */
  structuredContent?: unknown;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

/* ------------------------------ JSON-RPC ----------------------------- */

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
};

export type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
};

export type JsonRpcError = {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
};

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Standard JSON-RPC error codes plus MCP-specific extensions. */
export const RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
