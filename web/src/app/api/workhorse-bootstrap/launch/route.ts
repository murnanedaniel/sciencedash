import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDashboardOrigin } from "@/lib/brain/dashboard-origin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/workhorse-bootstrap/launch?projectId=<...>&repo=<absolute path>
 *
 * Returns a self-contained bash script that, when piped to `bash`,
 * sets up a workhorse on the current host pointed at the given project:
 *
 *   1. Creates ~/.sciencedash/ + writes auth.env with the Bearer token
 *      mirrored from the curl Authorization header.
 *   2. Writes sync.py / setup.sh / start-sync.sh (read from
 *      tools/workhorse-bootstrap/ at request time so the bash always
 *      ships the version the dashboard's currently running).
 *   3. Merges the project entry into ~/.sciencedash/config.json if it
 *      exists (replace by projectId), else writes fresh.
 *   4. Runs setup.sh to register cron/launcher and start sync.py.
 *
 * Same pattern as /brain-chat/launch — token mirrored from header into
 * the host's auth.env so it never leaves the user's shell environment.
 *
 * The user runs this on whatever compute host they want (Perlmutter
 * login, Vast box, friend's GPU machine):
 *
 *   bash <(curl -fsSL -H "Authorization: Bearer $TOK" \
 *     "https://homebox.tail598781.ts.net/api/workhorse-bootstrap/launch?projectId=<id>&repo=/path/on/this/host")
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    return new NextResponse(
      "# /api/workhorse-bootstrap/launch requires a Bearer token in Authorization header\n",
      {
        status: 401,
        headers: { "content-type": "text/x-shellscript; charset=utf-8" },
      },
    );
  }
  const token = m[1].trim();

  const { searchParams } = new URL(req.url);
  const projectId = (searchParams.get("projectId") ?? "").trim();
  const repo = (searchParams.get("repo") ?? "").trim();

  if (!projectId) {
    return errorResponse("missing required query param: projectId");
  }
  if (!repo) {
    return errorResponse("missing required query param: repo (absolute path to the repo on the target host)");
  }
  if (!repo.startsWith("/") && !repo.startsWith("~")) {
    return errorResponse(
      `repo must be an absolute path (or start with ~), got: ${repo}`,
    );
  }

  const dashboardUrl = await resolveDashboardOrigin();
  // sessionName convention: sd-<first-10-chars-of-projectId>. Stable per
  // (host, project) so re-running the bootstrap is idempotent.
  const sessionName = `sd-${projectId.slice(0, 10)}`;

  // Cancel any pending unread `stop_session` directives for this
  // session. Without this, a directive queued from a previous Remove
  // click sits in the DB; the moment the freshly-bootstrapped sync.py
  // fetches directives, it executes the stale stop_session — which
  // wipes the project entry from local config.json that the bootstrap
  // *just* added. Net effect: bootstrap looks like it worked, but the
  // workhorse never beats.
  //
  // Re-running the bootstrap is the user's signal "I want this active";
  // any prior stop intents are stale. Match by sessionName so directives
  // for any host (dashboard@host:session, mcp@host:session) are caught.
  const cancelled = await prisma.agentMessage.updateMany({
    where: {
      projectId,
      kind: "directive",
      body: "stop_session",
      source: { endsWith: `:${sessionName}` },
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  if (cancelled.count > 0) {
    console.log(
      `[workhorse-bootstrap] cancelled ${cancelled.count} stale stop_session directive(s) for ${sessionName}`,
    );
  }

  // Read the three bootstrap files from the repo's tools dir at request
  // time. Same pattern as /docs (web/src/app/(dash)/docs/page.tsx) and
  // /api/help — process.cwd() is `web/`, so `..` reaches the repo root.
  const bootstrapDir = join(process.cwd(), "..", "tools", "workhorse-bootstrap");
  const [setupSh, syncPy, startSyncSh] = await Promise.all([
    readFile(join(bootstrapDir, "setup.sh"), "utf-8"),
    readFile(join(bootstrapDir, "sync.py"), "utf-8"),
    readFile(join(bootstrapDir, "start-sync.sh"), "utf-8"),
  ]);

  const script = buildLaunchScript({
    token,
    dashboardUrl,
    projectId,
    sessionName,
    repo,
    setupSh,
    syncPy,
    startSyncSh,
  });

  return new NextResponse(script, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(message: string): NextResponse {
  return new NextResponse(`# error: ${message}\nexit 1\n`, {
    status: 400,
    headers: { "content-type": "text/x-shellscript; charset=utf-8" },
  });
}

/**
 * bash-safe single-quoting: wrap in single quotes, escape any inner
 * single quotes via the standard `'\''` dance.
 */
function bashSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildLaunchScript(args: {
  token: string;
  dashboardUrl: string;
  projectId: string;
  sessionName: string;
  repo: string;
  setupSh: string;
  syncPy: string;
  startSyncSh: string;
}): string {
  // Single-quoted heredoc terminators ('SDSETUP_EOF', 'SDSYNC_EOF',
  // 'SDSTARTSYNC_EOF', 'SDMERGE_EOF') prevent any shell expansion in
  // the body — sync.py and setup.sh contain $-vars and backticks that
  // must survive transit verbatim.
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "PROJECT_ID=" + bashSingleQuote(args.projectId),
    "SESSION_NAME=" + bashSingleQuote(args.sessionName),
    "REPO=" + bashSingleQuote(args.repo),
    "DASHBOARD_URL=" + bashSingleQuote(args.dashboardUrl),
    "AUTH_TOKEN=" + bashSingleQuote(args.token),
    "SCIENCEDASH_ROOT=\"${SCIENCEDASH_ROOT:-$HOME/.sciencedash}\"",
    "",
    "echo \"==> ScienceDash workhorse bootstrap\"",
    "echo \"    project:   $PROJECT_ID\"",
    "echo \"    session:   $SESSION_NAME\"",
    "echo \"    repo:      $REPO\"",
    "echo \"    dashboard: $DASHBOARD_URL\"",
    "echo \"    root:      $SCIENCEDASH_ROOT\"",
    "",
    "# If this host is running the dashboard service itself, warn and",
    "# pause — workhorses are typically run on COMPUTE hosts (Perlmutter,",
    "# Vast, GPU box), not on the dashboard server.",
    "if systemctl --user is-active sciencedash >/dev/null 2>&1; then",
    "  echo >&2",
    "  echo 'WARN: this host is running the ScienceDash dashboard (sciencedash.service active).' >&2",
    "  echo '      Workhorses are typically run on compute hosts, not on the dashboard server.' >&2",
    "  echo '      Continuing in 5s — Ctrl+C to abort.' >&2",
    "  sleep 5",
    "fi",
    "",
    "if ! command -v python3 >/dev/null 2>&1; then",
    "  echo 'ERROR: python3 not on PATH (sync.py needs it).' >&2",
    "  exit 1",
    "fi",
    "if ! command -v tmux >/dev/null 2>&1; then",
    "  echo 'WARN: tmux not on PATH — workhorse session will not start until you install tmux.' >&2",
    "fi",
    "",
    "mkdir -p \"$SCIENCEDASH_ROOT\"",
    "",
    "# auth.env — bearer token from the curl request, never leaves the host",
    "umask 077",
    "cat > \"$SCIENCEDASH_ROOT/auth.env\" <<SDAUTH_EOF",
    "SCIENCEDASH_AUTH_TOKEN=$AUTH_TOKEN",
    "SDAUTH_EOF",
    "",
    "# sync.py — daemon-style heartbeat sender",
    "cat > \"$SCIENCEDASH_ROOT/sync.py\" <<'SDSYNC_EOF'",
    args.syncPy,
    "SDSYNC_EOF",
    "chmod +x \"$SCIENCEDASH_ROOT/sync.py\"",
    "",
    "# setup.sh — idempotent installer (re-runs are safe)",
    "cat > \"$SCIENCEDASH_ROOT/setup.sh\" <<'SDSETUP_EOF'",
    args.setupSh,
    "SDSETUP_EOF",
    "chmod +x \"$SCIENCEDASH_ROOT/setup.sh\"",
    "",
    "# start-sync.sh — cron-friendly wrapper that nohups sync.py",
    "cat > \"$SCIENCEDASH_ROOT/start-sync.sh\" <<'SDSTARTSYNC_EOF'",
    args.startSyncSh,
    "SDSTARTSYNC_EOF",
    "chmod +x \"$SCIENCEDASH_ROOT/start-sync.sh\"",
    "",
    "# Merge the project entry into config.json. If config.json doesn't",
    "# exist, write fresh. If it does, replace any existing entry with",
    "# the same projectId. Other projects on this host stay untouched.",
    "PROJECT_ID=\"$PROJECT_ID\" SESSION_NAME=\"$SESSION_NAME\" REPO=\"$REPO\" DASHBOARD_URL=\"$DASHBOARD_URL\" \\",
    "  python3 - \"$SCIENCEDASH_ROOT/config.json\" <<'SDMERGE_EOF'",
    "import json, os, socket, sys",
    "cfg_path = sys.argv[1]",
    "entry = {",
    "    \"projectId\": os.environ[\"PROJECT_ID\"],",
    "    \"sessionName\": os.environ[\"SESSION_NAME\"],",
    "    \"repo\": os.environ[\"REPO\"],",
    "}",
    "try:",
    "    with open(cfg_path) as f: cfg = json.load(f)",
    "except (FileNotFoundError, json.JSONDecodeError):",
    "    cfg = {}",
    "cfg[\"dashboard_url\"] = cfg.get(\"dashboard_url\") or os.environ[\"DASHBOARD_URL\"]",
    "cfg[\"host\"] = cfg.get(\"host\") or socket.gethostname().split(\".\")[0]",
    "projects = [p for p in cfg.get(\"projects\", []) if p.get(\"projectId\") != entry[\"projectId\"]]",
    "projects.append(entry)",
    "cfg[\"projects\"] = projects",
    "with open(cfg_path, \"w\") as f:",
    "    json.dump(cfg, f, indent=2)",
    "    f.write(\"\\n\")",
    "print(f\"  config.json now has {len(projects)} project(s) for host {cfg['host']}\")",
    "SDMERGE_EOF",
    "",
    "echo",
    "echo \"==> running setup.sh (idempotent)\"",
    "DASHBOARD=\"$DASHBOARD_URL\" bash \"$SCIENCEDASH_ROOT/setup.sh\"",
    "",
    "echo",
    "echo \"==> done. sync.py beats every 60s; the Workhorse row should appear\"",
    "echo \"    on the project page within a minute. Tail logs:\"",
    "echo \"      tail -f $SCIENCEDASH_ROOT/sync.log\"",
    "",
  ].join("\n");
}
