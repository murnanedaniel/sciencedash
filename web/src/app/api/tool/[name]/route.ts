import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/tool/{name} — the REST tool gateway. The successor to the MCP
 * JSON-RPC endpoint: the `sciencedash` skill (and any HTTP caller) invokes a
 * ScienceDash tool by name with a plain JSON args body. Backed by the same
 * `callTool` core as the autonomous agents' in-process tool server, so there is
 * exactly one tool implementation. Proxy-gated (bearer) like every /api route.
 *
 *   curl -H "Authorization: Bearer $TOK" -d '{"kind":"project"}' \
 *     https://<dashboard>/api/tool/query_entity
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;

  let args: unknown = {};
  try {
    const raw = await req.text();
    args = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return NextResponse.json({ ok: false, error: "args must be a JSON object" }, { status: 400 });
  }

  const result = await callTool(name, args as Record<string, unknown>);
  const text =
    result.content?.find((c): c is { type: "text"; text: string } => c.type === "text")?.text ?? "";

  if (result.isError) {
    return NextResponse.json({ ok: false, error: text || "tool error" }, { status: 400 });
  }

  // Tools return JSON-as-text (jsonResult); parse it back for callers. Prose
  // results (textResult) aren't JSON — fall back to the raw string.
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return NextResponse.json({ ok: true, data });
}
