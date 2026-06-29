import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDashboardOrigin } from "@/lib/brain/dashboard-origin";

export const dynamic = "force-dynamic";

/**
 * GET /api/ambient-bootstrap/launch
 *
 * Self-contained bash installer for the ScienceDash ambient context layer.
 * Run it on any machine (laptop, Perlmutter, ...) — one command, no clone:
 *
 *   bash <(curl -fsSL -H "Authorization: Bearer $TOK" \
 *     "https://your-dashboard-host.example.com/api/ambient-bootstrap/launch")
 *
 * Mirrors /api/workhorse-bootstrap/launch: the bearer token is mirrored from
 * the curl header into ~/.sciencedash/auth.env, and the shipper / skill / hook
 * files are read from the repo at request time so the bash always ships the
 * version the dashboard is running. Installs: the transcript shipper + 1-min
 * cron, the `sciencedash` skill, and the SessionStart context hook, then
 * backfills this machine's history.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    return shell(
      "# /api/ambient-bootstrap/launch requires a Bearer token in the Authorization header\nexit 1\n",
      401,
    );
  }
  const token = m[1].trim();
  const dashboardUrl = await resolveDashboardOrigin();

  const root = join(process.cwd(), "..");
  const [shipPy, skillMd, sdPy, hookPy] = await Promise.all([
    readFile(join(root, "tools", "transcript-sync", "ship.py"), "utf-8"),
    readFile(join(root, "tools", "ambient", "skill", "sciencedash", "SKILL.md"), "utf-8"),
    readFile(join(root, "tools", "ambient", "skill", "sciencedash", "sd.py"), "utf-8"),
    readFile(join(root, "tools", "ambient", "hook", "session-start.py"), "utf-8"),
  ]);

  return shell(buildScript({ token, dashboardUrl, shipPy, skillMd, sdPy, hookPy }), 200);
}

function shell(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildScript(a: {
  token: string;
  dashboardUrl: string;
  shipPy: string;
  skillMd: string;
  sdPy: string;
  hookPy: string;
}): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "DASHBOARD_URL=" + q(a.dashboardUrl),
    "AUTH_TOKEN=" + q(a.token),
    'SD="$HOME/.sciencedash"',
    'CLAUDE="$HOME/.claude"',
    'HOOK="$CLAUDE/hooks/sciencedash-session-start.py"',
    "",
    'echo "==> ScienceDash ambient install   dashboard: $DASHBOARD_URL"',
    "if ! command -v python3 >/dev/null 2>&1; then echo 'ERROR: python3 required' >&2; exit 1; fi",
    'mkdir -p "$SD/transcript-sync" "$SD/transcripts" "$SD/context" "$CLAUDE/skills/sciencedash" "$CLAUDE/hooks"',
    "",
    "# --- auth.env (bearer from the curl header; never leaves this host) ---",
    "umask 077",
    'cat > "$SD/auth.env" <<SDAUTH_EOF',
    "SCIENCEDASH_AUTH_TOKEN=$AUTH_TOKEN",
    "SDAUTH_EOF",
    "umask 022",
    "",
    "# --- config.json (dashboard url + host) ---",
    'DASHBOARD_URL="$DASHBOARD_URL" python3 - "$SD/config.json" <<\'SDCFG_EOF\'',
    "import json, os, socket, sys",
    "p = sys.argv[1]",
    "try: d = json.load(open(p))",
    "except Exception: d = {}",
    'd["dashboard_url"] = os.environ["DASHBOARD_URL"]',
    'd["host"] = d.get("host") or socket.gethostname().split(".")[0]',
    'json.dump(d, open(p, "w"), indent=2)',
    "SDCFG_EOF",
    "",
    "# --- transcript shipper ---",
    "cat > \"$SD/transcript-sync/ship.py\" <<'SDSHIP_EOF'",
    a.shipPy,
    "SDSHIP_EOF",
    'chmod +x "$SD/transcript-sync/ship.py"',
    "",
    "# --- sciencedash skill ---",
    "cat > \"$CLAUDE/skills/sciencedash/SKILL.md\" <<'SDSKILL_EOF'",
    a.skillMd,
    "SDSKILL_EOF",
    "cat > \"$CLAUDE/skills/sciencedash/sd.py\" <<'SDSDPY_EOF'",
    a.sdPy,
    "SDSDPY_EOF",
    'chmod +x "$CLAUDE/skills/sciencedash/sd.py"',
    "",
    "# --- SessionStart context hook ---",
    "cat > \"$HOOK\" <<'SDHOOK_EOF'",
    a.hookPy,
    "SDHOOK_EOF",
    'chmod +x "$HOOK"',
    "",
    "# --- register the hook in ~/.claude/settings.json (idempotent, backed up) ---",
    'HOOK="$HOOK" python3 - "$CLAUDE/settings.json" <<\'SDSET_EOF\'',
    "import json, os, sys, time, shutil",
    "path = sys.argv[1]",
    'cmd = "python3 " + os.environ["HOOK"]',
    "try: s = json.load(open(path))",
    "except Exception: s = {}",
    "if os.path.exists(path): shutil.copy(path, path + f'.bak.{int(time.time())}')",
    'ss = s.setdefault("hooks", {}).setdefault("SessionStart", [])',
    "present = any(any(h.get('command')==cmd for h in (g.get('hooks') or [])) for g in ss if isinstance(g, dict))",
    "if not present:",
    '    ss.append({"hooks": [{"type": "command", "command": cmd, "timeout": 12}]})',
    '    json.dump(s, open(path, "w"), indent=2)',
    "    print('  hook registered in settings.json')",
    "else:",
    "    print('  hook already in settings.json')",
    "SDSET_EOF",
    "",
    "# --- cron: ship transcripts every minute ---",
    'CRON="* * * * * SCIENCEDASH_URL=$DASHBOARD_URL /usr/bin/env python3 $SD/transcript-sync/ship.py >> $SD/transcripts/ship.log 2>&1"',
    "( crontab -l 2>/dev/null | grep -v 'transcript-sync/ship.py' ; echo \"$CRON\" ) | crontab - && echo '  cron installed (every 1 min)'",
    "",
    "# --- initial backfill of this machine's history ---",
    'echo "==> backfilling this machine\'s sessions..."',
    'SCIENCEDASH_URL="$DASHBOARD_URL" python3 "$SD/transcript-sync/ship.py" || echo "  (backfill will retry on the next cron tick)"',
    "",
    "echo",
    'echo "==> done. New sessions get project context; transcripts ship every minute;"',
    'echo "    the \'sciencedash\' skill is available in every session on this machine."',
    "",
  ].join("\n");
}
