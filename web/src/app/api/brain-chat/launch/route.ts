import { NextRequest, NextResponse } from "next/server";
import { buildBrainChatContext } from "@/lib/brain/chat-context";
import { buildMcpServerConfig } from "@/lib/brain/mcp-client";
import { resolveDashboardOrigin } from "@/lib/brain/dashboard-origin";

export const dynamic = "force-dynamic";

/**
 * GET /api/brain-chat/launch — returns a complete bash script that, when
 * piped to `bash`, drops the user into a tmux + claude session with the
 * ScienceDash MCP loaded and a fresh CHAT_CONTEXT primer.
 *
 * Usage from the user's terminal:
 *
 *   curl -fsSL -H "Authorization: Bearer <TOKEN>" \
 *     https://homebox.tail598781.ts.net/api/brain-chat/launch | bash
 *
 * The Bearer token from the curl request is mirrored back into the
 * `.mcp.json` the script writes — the chat Claude calls /api/mcp using
 * the same token, so the proxy lets it through. Token never leaves the
 * user's shell environment / the homebox server-side render.
 *
 * Auth: gated by the proxy (Bearer required for non-HTML requests).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    // Proxy already enforces this for non-HTML requests, but be explicit:
    // the launcher specifically needs a Bearer to mirror back.
    return new NextResponse(
      "# /api/brain-chat/launch requires a Bearer token in Authorization header\n",
      {
        status: 401,
        headers: { "content-type": "text/x-shellscript; charset=utf-8" },
      },
    );
  }
  const token = m[1].trim();

  const [dashboardUrl, primer] = await Promise.all([
    resolveDashboardOrigin(),
    buildBrainChatContext(),
  ]);

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        sciencedash: buildMcpServerConfig({ dashboardUrl, token }),
      },
    },
    null,
    2,
  );

  // Single-quoted heredoc terminators ('SDMCP_EOF', 'SDCTX_EOF') prevent
  // shell expansion inside the file bodies — token characters, $, and
  // backticks are all safe.
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "WORKSPACE=\"$HOME/.sciencedash/brain-chat\"",
    "mkdir -p \"$WORKSPACE\"",
    "",
    "cat > \"$WORKSPACE/.mcp.json\" <<'SDMCP_EOF'",
    mcpConfig,
    "SDMCP_EOF",
    "chmod 600 \"$WORKSPACE/.mcp.json\"",
    "",
    "cat > \"$WORKSPACE/CHAT_CONTEXT.md\" <<'SDCTX_EOF'",
    primer,
    "SDCTX_EOF",
    "",
    "cd \"$WORKSPACE\"",
    "if ! command -v claude >/dev/null 2>&1; then",
    "  echo 'ERROR: `claude` CLI not on PATH. Install Claude Code first: https://docs.claude.com/claude-code' >&2",
    "  exit 1",
    "fi",
    "if ! command -v tmux >/dev/null 2>&1; then",
    "  echo 'ERROR: `tmux` not installed. apt install tmux (or brew install tmux).' >&2",
    "  exit 1",
    "fi",
    "",
    "exec tmux new -As sd-brain 'claude --continue --mcp-config .mcp.json --append-system-prompt \"$(cat CHAT_CONTEXT.md)\" 2>/dev/null || claude --mcp-config .mcp.json --append-system-prompt \"$(cat CHAT_CONTEXT.md)\"'",
    "",
  ].join("\n");

  return new NextResponse(script, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
