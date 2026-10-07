# Perlmutter RC keeper

1. Install and log in to Claude Code at `~/.local/bin/claude` on Perlmutter.
   The heartbeat uses bash, standard POSIX tools, python3 and curl; no jq.
2. Create `~/sciencedash-bridge`, copy `heartbeat.sh` and `parse_sessions.py` there, and copy
   `keeper.sh.example` there as `keeper.sh`. Make both executable with
   `chmod +x ~/sciencedash-bridge/heartbeat.sh ~/sciencedash-bridge/keeper.sh`.
   Keep this directory stable: its real path, with `/` replaced by `-`,
   identifies `~/.claude/projects/<key>/bridge-pointer.json`.
3. Configure `~/.sciencedash/config.json` with `"dashboard_url": "https://<dashboard>"`
   and `~/.sciencedash/auth.env` with `SCIENCEDASH_AUTH_TOKEN='<token>'`.
   Restrict the token file with `chmod 600 ~/.sciencedash/auth.env`.
   Existing dashboard configuration and token files can be reused unchanged. Environment variables
   `SCIENCEDASH_URL` and `SCIENCEDASH_AUTH_TOKEN` override file values.
4. Run `scrontab -e` and install the following (replace `<acct>` and the absolute path):

   ```text
   #SCRON -q cron -A <acct> -t 24:00:00 --time-min=00:30:00 -J perlmutter-rc
   */5 * * * * /absolute/path/to/sciencedash-bridge/keeper.sh
   ```

The keeper starts the heartbeat in the background in the Slurm job, writes
its PID before exec, and runs `claude rc`. Slurm cleans up the heartbeat
with the job. Heartbeats retry every 60 seconds even after errors. The
stable bridge name is `perlmutter`; `BRIDGE_DIR` selects the keeper directory.

To stop: remove the schedule with `scrontab -r`, then send SIGTERM to the rc
PID on the node hosting the job (`kill -TERM "$(cat ~/sciencedash-bridge/rc.pid)"`).
Never use plain `scancel`: it does not perform this intended shutdown sequence.

The dashboard reconciles every minute. Set `SCIENCEDASH_BRIDGE_WAKE=0` in
its environment to disable actual wake commands while retaining decisions
and state updates. Creating sessions remains manual in phase 1: create the
session through a Claude session's remote MCP tools, then call
`register_rc_workhorse` with `projectId`, `bridgeName`, `rcSessionId`,
`rcEnvId` and optional `repo`. This acknowledges pending recreate directives.
