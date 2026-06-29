import { NextRequest, NextResponse } from "next/server";
import { buildBrainChatContext } from "@/lib/brain/chat-context";
import { resolveDashboardOrigin } from "@/lib/brain/dashboard-origin";
import { BRAIN_CHAT_SKILLS } from "@/lib/brain/skills";

export const dynamic = "force-dynamic";

/**
 * GET /api/brain-chat/launch — returns a complete bash script that, when
 * piped to `bash`, drops the user into a tmux + claude session with the
 * ScienceDash MCP loaded and a fresh CHAT_CONTEXT primer.
 *
 * Usage from the user's terminal:
 *
 *   curl -fsSL -H "Authorization: Bearer <TOKEN>" \
 *     https://your-dashboard-host.example.com/api/brain-chat/launch | bash
 *
 * The Bearer token from the curl request is exported into the session's
 * environment (SCIENCEDASH_AUTH_TOKEN/SCIENCEDASH_URL) so the installed
 * `sciencedash` skill can reach the dashboard's REST tool gateway. Token
 * never leaves the user's shell environment / the dashboard's
 * server-side render.
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

  // Single-quoted shell literal: wrap value in '…' and escape any embedded
  // single quote as '\'' so tokens/URLs survive verbatim with no expansion.
  const shq = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;

  // Single-quoted heredoc terminators ('SDCTX_EOF', 'SDSKILL_EOF') prevent
  // shell expansion inside the file bodies — token characters, $, and
  // backticks are all safe.
  const skillBlocks: string[] = [];
  for (const skill of BRAIN_CHAT_SKILLS) {
    skillBlocks.push(
      `mkdir -p "$WORKSPACE/.claude/skills/${skill.name}"`,
      `cat > "$WORKSPACE/.claude/skills/${skill.name}/${skill.filename}" <<'SDSKILL_EOF'`,
      skill.body,
      "SDSKILL_EOF",
    );
  }

  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "WORKSPACE=\"$HOME/.sciencedash/brain-chat\"",
    "mkdir -p \"$WORKSPACE\"",
    "",
    "# Tools reach ScienceDash through the installed `sciencedash` skill,",
    "# which reads these from the environment (REST tool gateway, bearer).",
    `export SCIENCEDASH_URL=${shq(dashboardUrl)}`,
    `export SCIENCEDASH_AUTH_TOKEN=${shq(token)}`,
    "",
    "cat > \"$WORKSPACE/CHAT_CONTEXT.md\" <<'SDCTX_EOF'",
    primer,
    "SDCTX_EOF",
    "",
    "# Skills — recipes Claude Code will auto-discover from .claude/skills/.",
    ...skillBlocks,
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
    "exec tmux new -As sd-brain 'claude --continue --append-system-prompt \"$(cat CHAT_CONTEXT.md)\" 2>/dev/null || claude --append-system-prompt \"$(cat CHAT_CONTEXT.md)\"'",
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
