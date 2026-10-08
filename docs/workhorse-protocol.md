# Workhorse protocol

Workhorses are Claude Code Remote Control (RC) sessions. The dashboard records
one workhorse per `(projectId, bridgeName)`. Project state is shared through the
`sciencedash` skill; the bridge carries session messages.

## Bridge heartbeat

The [bridge keeper](../tools/bridge-keeper/README.md) runs `claude rc` under
Slurm's cron QOS on Perlmutter. Its heartbeat posts every 60 seconds to
`POST /api/bridge/heartbeat` with `Authorization: Bearer <token>`:

```json
{
  "name": "perlmutter",
  "envId": "env_example",
  "node": "login32",
  "jobId": "12345",
  "rcAlive": true,
  "claudeVersion": "<version>",
  "liveSessions": ["cse_example"]
}
```

Only `name` and `rcAlive` are required. Names match `[a-z0-9-]{1,40}`;
`liveSessions` contains at most 200 ids. The endpoint upserts `Bridge` by name,
stores the payload and receipt time, and returns `{ "ok": true }`.

A bridge is fresh for less than 3 minutes after its last heartbeat, stale until
15 minutes, and down thereafter (or when no heartbeat exists). `/api/health/hosts`
returns bridges only, including node, environment, age and workhorse count.

## Registration and lifecycle

Create a session on the bridge through a Claude session's remote tools, then call
`register_rc_workhorse` with `projectId`, `bridgeName`, `rcSessionId`, `rcEnvId`
and optional `repo`. Registration upserts by project and bridge, sets state to
`live`, resets wake attempts, and acknowledges pending `recreate_rc_workhorse`
directives for that project. The dashboard does not create remote sessions.

The project panel links to `https://claude.ai/code/<rcSessionId>` and shows
bridge, state, last wake and last tick. States are `live`, `waking`,
`needs_recreate`, `stopped`, and derived `bridge_down` when the bridge is not
fresh. Stopped state remains visible even if the bridge is down.

- `stop_all_workhorses(projectId?, bridgeName?)` sets state to `stopped`.
  Automated ticks and reconciliation skip stopped rows; a running turn can finish.
- `resume_workhorse(projectId, bridgeName?)` sets state to `live` and wake count to zero.
- `remove_workhorse(id)` deletes the registration. It does not terminate the remote session.

## Recovery

The reconciler runs every minute for active projects whose workhorse tempo is not
paused. It never acts on a workhorse with a non-fresh bridge or stopped state.

When the environment matches, a session in `liveSessions` is marked live and its
wake count reset. Session ids with `session_` and `cse_` prefixes compare by suffix.
Missing sessions receive a wake message via `claude -p <message> --cloud <id>
--output-format json`, without a shell. Retry delay is `min(5 min × 2^wakeCount,
60 min)`. After eight wakes, or if the environment changes, the reconciler
records a `recreate_rc_workhorse` directive and posts a warning, deduplicated for
six hours. A person must create and register the replacement.

Bridge outages of at least thirty minutes generate a deduplicated system alert;
a fresh heartbeat clears it. The keeper handles bridge recovery. Restarts within
about four hours can preserve the environment id; longer outages may require
session recreation. See the [RC design](./specs/rc-transport.md) for context.

## Workhorse ticks

Every thirty minutes the worker considers active projects. Scheduled ticks require
`workhorse_tick` autonomy `auto`; `ask` posts a permission alert, and `propose`
skips scheduled delivery. Explicit `dispatch_workhorse(projectId, bridgeName?,
actionClass?, reason?)` uses the same RC delivery and tempo gates; `propose` also
posts a heads-up. Its default action class is `workhorse_tick`.

Tempo is `workhorseIntervalSec`: zero pauses, null defaults to one hour. Each tick
requires state `live`, a fresh bridge and an elapsed interval since `lastTickAt`.
The dashboard records the attempt time and sends:

> ScienceDash tick for project "<title>" (<projectId>): check the project brief and recent check-ins via the sciencedash skill, do the next step if there is one, post a check-in, then stop. If nothing to do, reply "idle".

Failed sends post a warning and wait until the next eligible interval. Setting
`SCIENCEDASH_BRIDGE_WAKE=0` disables actual sends while retaining state updates.

## Ambient context

Transcript shipping is independent of workhorse registration. Keep
`tools/transcript-sync/`, `tools/ambient/`, `/api/ambient-bootstrap/launch` and
`/api/ingest/*` installed and reachable. The shipper, bridge heartbeat and `sd.py`
all retain bearer authentication.
