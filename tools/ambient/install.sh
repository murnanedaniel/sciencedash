#!/usr/bin/env bash
#
# ScienceDash ambient-context installer. Run once per machine (homebox, laptop,
# Perlmutter, ...). Sets up, idempotently:
#   1. ~/.sciencedash/{auth.env,config.json}  (bearer token + dashboard url)
#   2. the transcript shipper + a 1-min cron job (ships session JSONLs)
#   3. the `sciencedash` skill            -> ~/.claude/skills/sciencedash/
#   4. the SessionStart context hook      -> ~/.claude/hooks/ + ~/.claude/settings.json
#
# Usage:
#   SCIENCEDASH_URL=https://your-dashboard SCIENCEDASH_AUTH_TOKEN=<token> \
#     bash tools/ambient/install.sh
# On the dashboard host itself, URL defaults to http://localhost:3000 and the
# token is read from web/.env if not provided.
set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
SD="$HOME/.sciencedash"
CLAUDE="$HOME/.claude"
URL="${SCIENCEDASH_URL:-http://localhost:3000}"
TOKEN="${SCIENCEDASH_AUTH_TOKEN:-}"

# Fall back to web/.env token when running on the dashboard host.
if [ -z "$TOKEN" ] && [ -f "$REPO/web/.env" ]; then
  TOKEN="$(grep -E '^SCIENCEDASH_AUTH_TOKEN=' "$REPO/web/.env" | head -1 | cut -d= -f2- | tr -d '"'\'' ')"
fi
if [ -z "$TOKEN" ]; then
  echo "ERROR: set SCIENCEDASH_AUTH_TOKEN (the dashboard's bearer token)." >&2
  exit 1
fi

echo "→ ScienceDash ambient install   repo=$REPO   url=$URL"
mkdir -p "$SD" "$SD/transcript-sync" "$SD/transcripts" "$SD/context" "$CLAUDE/skills" "$CLAUDE/hooks"

# 1. auth.env + config.json --------------------------------------------------
if [ ! -f "$SD/auth.env" ] || ! grep -q '^SCIENCEDASH_AUTH_TOKEN=' "$SD/auth.env"; then
  printf 'SCIENCEDASH_AUTH_TOKEN=%s\n' "$TOKEN" > "$SD/auth.env"
  chmod 600 "$SD/auth.env"
  echo "  ✓ wrote $SD/auth.env"
else
  echo "  • $SD/auth.env already present (left as-is)"
fi
python3 - "$SD/config.json" "$URL" <<'PY'
import json, sys
p, url = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(p))
except Exception:
    d = {}
d["dashboard_url"] = url
json.dump(d, open(p, "w"), indent=2)
print(f"  ✓ {p} dashboard_url={url}")
PY

# 2. transcript shipper + cron ----------------------------------------------
cp "$REPO/tools/transcript-sync/ship.py" "$SD/transcript-sync/ship.py"
chmod +x "$SD/transcript-sync/ship.py"
CRON_LINE="* * * * * SCIENCEDASH_URL=$URL /usr/bin/env python3 $SD/transcript-sync/ship.py >> $SD/transcripts/ship.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'transcript-sync/ship.py' ; echo "$CRON_LINE" ) | crontab -
echo "  ✓ shipper installed + cron (every 1 min)"

# 3. skill -------------------------------------------------------------------
mkdir -p "$CLAUDE/skills/sciencedash"
cp "$REPO/tools/ambient/skill/sciencedash/SKILL.md" "$REPO/tools/ambient/skill/sciencedash/sd.py" "$CLAUDE/skills/sciencedash/"
chmod +x "$CLAUDE/skills/sciencedash/sd.py"
echo "  ✓ skill -> $CLAUDE/skills/sciencedash/"

# 4. SessionStart hook + settings.json --------------------------------------
cp "$REPO/tools/ambient/hook/session-start.py" "$CLAUDE/hooks/sciencedash-session-start.py"
chmod +x "$CLAUDE/hooks/sciencedash-session-start.py"
python3 - "$CLAUDE/settings.json" "$CLAUDE/hooks/sciencedash-session-start.py" <<'PY'
import json, os, sys, time
path, hook_py = sys.argv[1], sys.argv[2]
cmd = f"python3 {hook_py}"
try:
    settings = json.load(open(path))
except Exception:
    settings = {}
if os.path.exists(path):
    import shutil
    shutil.copy(path, path + f".bak.{int(time.time())}")
hooks = settings.setdefault("hooks", {})
ss = hooks.setdefault("SessionStart", [])
# idempotent: only add our hook if not already present
present = any(
    any(h.get("command") == cmd for h in (grp.get("hooks") or []))
    for grp in ss if isinstance(grp, dict)
)
if not present:
    ss.append({"hooks": [{"type": "command", "command": cmd, "timeout": 12}]})
    json.dump(settings, open(path, "w"), indent=2)
    print(f"  ✓ SessionStart hook added to {path} (backup saved)")
else:
    print(f"  • SessionStart hook already in {path}")
PY

echo ""
echo "Done. The shipper ships transcripts every minute; new sessions get project"
echo "context injected; the 'sciencedash' skill is available in every session."
echo "Backfill now:  SCIENCEDASH_URL=$URL python3 $SD/transcript-sync/ship.py"
echo "Disable the hook: remove the SessionStart entry from $CLAUDE/settings.json"
echo "Disable shipping: crontab -e  (delete the ship.py line)"
