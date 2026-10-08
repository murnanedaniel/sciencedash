# Cluster Claude integration

ScienceDash workhorses run as Claude Code Remote Control sessions on named
bridges. The dashboard monitors the bridge, wakes idle sessions after recovery,
and sends project ticks. Setup is maintained in the
[bridge keeper README](../tools/bridge-keeper/README.md).

## Install the Perlmutter bridge

You need Claude Code installed and logged in at `~/.local/bin/claude`, bash,
python3, curl, POSIX tools, access to Slurm's cron QOS, and outbound HTTPS to the
dashboard. Keep the dashboard URL stable across login nodes.

1. Create `~/sciencedash-bridge`. Copy `heartbeat.sh`, `parse_sessions.py` and
   `keeper.sh.example` from `tools/bridge-keeper/` there. Rename the example to
   `keeper.sh`, adjust its account/paths, and make both shell scripts executable.
2. Set `dashboard_url` in `~/.sciencedash/config.json` and
   `SCIENCEDASH_AUTH_TOKEN='<token>'` in `~/.sciencedash/auth.env`. Restrict the
   token file to mode 600. Existing ambient configuration can be reused.
   `SCIENCEDASH_URL` and `SCIENCEDASH_AUTH_TOKEN` environment variables override
   these file values.
3. Install the keeper using `scrontab -e`:

   ```text
   #SCRON -q cron -A <acct> -t 24:00:00 --time-min=00:30:00 -J perlmutter-rc
   */5 * * * * /absolute/path/to/sciencedash-bridge/keeper.sh
   ```

Keep the keeper directory stable: its real path identifies the Claude
`bridge-pointer.json` file. The keeper starts the heartbeat, writes `rc.pid`, and
executes `claude rc --name perlmutter`. Heartbeat errors retry every minute;
Slurm restarts a failed job on the schedule.

## Register a project session

Install ambient context from **Settings → Ambient context — add a machine** so
the host has the `sciencedash` skill and transcript shipper. These remain separate
from bridge recovery and workhorse ticks.

Create a session on `perlmutter` through a Claude session's remote tools, then use
the skill to call:

```bash
sd.py call register_rc_workhorse '{"projectId":"<id>","bridgeName":"perlmutter","rcSessionId":"session_<id>","rcEnvId":"env_<id>","repo":"/absolute/repo/path"}'
```

`repo` is optional. There is one registration per project and bridge; registering
again replaces that association. Verify the sidebar shows a fresh bridge and
the project Workhorses panel shows the session link and `live` state.

## Daily operation

Set project autonomy `workhorse_tick` to Auto for scheduled ticks. The worker
checks every thirty minutes and observes project tempo (default one hour;
zero pauses). `dispatch_workhorse` sends the same tick through the autonomy gates.

**Stop** pauses automated recovery and ticks. **Resume** enables them again and
resets wake attempts. **Remove** unregisters the row. These controls do not
terminate an already-running Claude turn.

## Recovery and troubleshooting

- `bridge_down`: check keeper job, heartbeat stderr, dashboard URL and bearer
  token. The reconciler waits until heartbeats are fresh again.
- `waking`: the dashboard has attempted to wake a session; retries back off up to
  an hour. Check project warnings if delivery fails.
- `needs_recreate`: create a replacement session in the current environment and
  register it. Registration acknowledges the recreation request.
- `stopped`: use Resume when you want automated recovery and ticks again.

To stop the keeper itself, use `scrontab -r` followed by SIGTERM to its RC PID on
the hosting node. Never use plain `scancel`. Full instructions and the shutdown
command are in the [keeper README](../tools/bridge-keeper/README.md).

See [workhorse-protocol.md](./workhorse-protocol.md) for heartbeat fields,
freshness thresholds, tick messages and recovery rules.
