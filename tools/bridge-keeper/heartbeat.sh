#!/usr/bin/env bash
# No errexit: a failed sample or POST must not end the keeper heartbeat.
heartbeat_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1

heartbeat() (
  # Read values as data, without executing auth.env as shell code.
  SCIENCEDASH_URL=${SCIENCEDASH_URL:-$(python3 -c '
import json, pathlib
print(json.loads((pathlib.Path.home()/".sciencedash/config.json").read_text())["dashboard_url"])
')} || return
  SCIENCEDASH_AUTH_TOKEN=${SCIENCEDASH_AUTH_TOKEN:-$(python3 -c '
import pathlib
for line in (pathlib.Path.home()/".sciencedash/auth.env").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == "SCIENCEDASH_AUTH_TOKEN":
        print(value.strip().strip(chr(34)).strip(chr(39)))
        break
')} || return
  if [ -z "$SCIENCEDASH_URL" ] || [ -z "$SCIENCEDASH_AUTH_TOKEN" ] || [ -z "$BRIDGE_DIR" ]; then
    echo 'bridge heartbeat: BRIDGE_DIR, dashboard URL and auth token are required' >&2
    return 1
  fi
  bridge_node=$(hostname) || return
  bridge_version=$("$HOME/.local/bin/claude" --version) || return
  bridge_alive=false
  if [ -r "$BRIDGE_DIR/rc.pid" ]; then
    bridge_pid=$(cat "$BRIDGE_DIR/rc.pid")
    case "$bridge_pid" in
      ''|*[!0-9]*) ;;
      *) if [ "$bridge_pid" -gt 0 ] && kill -0 "$bridge_pid" 2>/dev/null; then bridge_alive=true; fi ;;
    esac
  fi
  bridge_processes=$(ps -u "$USER" -o args=) || return
  bridge_sessions=$(printf '%s\n' "$bridge_processes" | python3 "$heartbeat_dir/parse_sessions.py") || return
  bridge_payload=$(printf '%s\n' "$bridge_sessions" | python3 -c '
import json, pathlib, sys
bridge_dir, name, node, job_id, alive, version = sys.argv[1:]
key = str(pathlib.Path(bridge_dir).resolve()).replace("/", "-")
pointer = pathlib.Path.home()/".claude/projects"/key/"bridge-pointer.json"
env_id = None
try:
    data = json.loads(pointer.read_text())
    env_id = data.get("environmentId") or data.get("envId") or data.get("environment_id")
except (OSError, ValueError) as exc:
    print(f"bridge heartbeat: {exc}", file=sys.stderr)
sessions = json.load(sys.stdin)
payload = dict(name=name, node=node, jobId=job_id, rcAlive=alive == "true", claudeVersion=version, liveSessions=sessions[:200])
if isinstance(env_id, str):
    payload["envId"] = env_id
print(json.dumps(payload))
' "$BRIDGE_DIR" "${BRIDGE_NAME:-perlmutter}" "$bridge_node" "${SLURM_JOB_ID:-}" "$bridge_alive" "$bridge_version") || return
  curl -fsS --max-time 20 \
    -H "Authorization: Bearer $SCIENCEDASH_AUTH_TOKEN" \
    -H 'User-Agent: sciencedash-bridge/1' \
    -H 'Content-Type: application/json' \
    --data "$bridge_payload" "${SCIENCEDASH_URL%/}/api/bridge/heartbeat" >/dev/null
)

while true; do
  heartbeat || echo 'bridge heartbeat: sample or POST failed; retrying in 60s' >&2
  sleep 60
done
