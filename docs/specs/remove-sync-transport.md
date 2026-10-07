# Spec: remove the sync.py/tmux workhorse transport (W8 phase 1b)

Status: ready to implement on branch `w8-remove-sync`, off main 899b656. **Do not push to main.**

## Why
Phase 1 (`docs/specs/rc-transport.md`, merged) moved workhorses onto Claude Code Remote Control bridges. The old transport has been dead on Perlmutter since 2026-06-17. Here "the old transport" means the `sync.py` daemon, tmux sessions, directive polling over `/api/mcp/sync` and `/api/mcp/host-sync`, and the `/api/workhorse-bootstrap` installer. Daniel has asked for all of it to be removed. After this change, **Remote Control bridges are the only workhorse transport.**

## Must keep (do not break)
- **Ambient transcript shipping:** `tools/transcript-sync/`, `tools/ambient/`, `/api/ambient-bootstrap/launch` and `/api/ingest/*`. This is *not* sync.py. Only update the stale comment in ambient-bootstrap that mentions workhorse-bootstrap.
- **The phase 1 RC code:** the `Bridge` model, `/api/bridge/heartbeat`, `web/src/lib/bridge/*`, `register_rc_workhorse` and `tools/bridge-keeper/`.
- **`AgentMessage` with `kind = directive`:** it's still used for `recreate_rc_workhorse`.
- **Bearer auth in `proxy.ts`/`auth.ts`:** used by bridges, the ambient shipper and sd.py. Only update comments that mention sync.py.

## Remove
1. **Files and directories:**
   - `tools/workhorse-bootstrap/` (sync.py, setup.sh, start-sync.sh)
   - `web/src/app/api/mcp/sync/`
   - `web/src/app/api/mcp/host-sync/`
   - `web/src/app/api/workhorse-bootstrap/`
2. **MCP tools in `write.ts`:**
   - `queue_directive`
   - `dispatch_workhorse_session`: replaced by phase 2's dispatcher. For now, creating a workhorse is "create a session on the bridge, then call `register_rc_workhorse`".
   - Remove these names everywhere they're referenced: allow and deny lists in `agentClient.ts`, `brain/skills.ts`, `brain/chat-context.ts`, `chat/system-prompt.ts`, `brain/autonomy.ts`, `server/agentMessageActions.ts` and `api/chat/stream/route.ts`.
3. **The tmux parts of the UI:**
   - `AddWorkhorseForm.tsx` (it generates tmux start commands)
   - `buildStartCommand` and the tmux/heartbeat state rendering in `WorkhorsesPanel.tsx`
   - the tmux host rows in `/api/health/hosts`
   - any "copy this command to start sync.py" text on the settings page
4. **Docs:**
   - Rewrite `docs/workhorse-protocol.md` and `docs/cluster-integration.md` for the bridge model, using `tools/bridge-keeper/README.md` and `docs/specs/rc-transport.md` as sources.
   - Remove the sync.py setup steps from `docs/setup-tutorial.md` and `docs/tutorial.md`, replacing them with a short pointer to the bridge keeper.
   - Update `tools/chat-context/user_brief.example.md` if it mentions sync.py.

## Change (port the behaviour worth keeping to RC)
### A. `Workhorse` model: becomes RC-only
Final fields:
```prisma
model Workhorse {
  id                  String    @id @default(cuid())
  createdAt           DateTime  @default(now())
  projectId           String
  project             Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  bridgeName          String
  rcSessionId         String
  rcEnvId             String?
  rcState             String?   // "live" | "waking" | "needs_recreate" | "stopped"
  lastWakeAt          DateTime?
  wakeCount           Int       @default(0)
  recreateRequestedAt DateTime?
  lastTickAt          DateTime?
  repo                String?
  @@unique([projectId, bridgeName])
  @@index([bridgeName])
  @@index([projectId])
}
```
- Drop `host`, `sessionName`, `lastHeartbeat`, `lastClaudeBeat`, `configJson` and `transport`.
- The migration must:
  1. delete every row where `transport != 'rc'` (all existing rows are dead tmux workhorses from before June)
  2. rebuild the table, SQLite-style, keeping the rc rows
  3. map the old `host` column to `bridgeName` where `bridgeName` is null
- It must apply cleanly to a copy of the production DB.
- Update every reader and writer, including `read.ts`, where `deriveWorkhorseState` must now derive its state from `rcState` plus the Bridge's freshness. Values: "live" | "waking" | "needs_recreate" | "stopped" | "bridge_down".

### B. `register_rc_workhorse`
Upsert by `(projectId, bridgeName)`. Accept `repo` as optional input.

### C. `stop_all_workhorses` and `remove_workhorse`
- **`stop_all_workhorses`:** set `rcState = "stopped"` on every workhorse, or on one project's if `projectId` is given. It no longer queues directives.
- **`remove_workhorse`:** delete the row.
- Add a `resume_workhorse` tool `{projectId, bridgeName?}` that sets `rcState = "live"` and `wakeCount = 0` so the reconciler takes it over again.
- **Reconciler (`reconcile.ts`):** workhorses with `rcState === "stopped"` produce no actions. Add a unit test for this. Update `WorkhorseView` for the field changes.

### D. Workhorse ticks over RC (replaces `workhorseTickAll` and `dispatch_workhorse`)
- Keep the `workhorse_tick_global` tick (every 30 min) and its autonomy and tempo gating, exactly as today: `decideAutonomy`, `workhorseIntervalSec`, 0 means paused, null falls back to `DEFAULT_WORKHORSE_INTERVAL_SEC`.
- Change the "nudge" step. Instead of queuing a directive, for each eligible workhorse:
  - **Skip** it if `rcState` isn't `"live"`, if its bridge isn't fresh, or if `lastTickAt` is within the interval.
  - **Otherwise** call `wakeSession(rcSessionId, tickMessage)` from `web/src/lib/bridge/wake.ts` and set `lastTickAt = now`. The message: `ScienceDash tick for project "<title>" (<projectId>): check the project brief and recent check-ins via the sciencedash skill, do the next step if there is one, post a check-in, then stop. If nothing to do, reply "idle".`
  - "Ask" autonomy keeps its current behaviour: a permission alert, not a tick.
- **`dispatch_workhorse` (MCP tool):** keep the name and the autonomy checks, but implement it as the same RC tick for that project's workhorse. If there's no live rc workhorse, return a clear error.
- Return skip counters as before, renamed sensibly (`skippedNotLive`, `skippedBridgeDown`, `skippedTempo`, …).

### E. UI
- **`WorkhorsesPanel`:** show the rc workhorses for the project: bridge, session link (`https://claude.ai/code/<rcSessionId>`), state, last wake, last tick. Include Stop/Resume/Remove buttons, which call the tools above through the existing server-action pattern, and a short note: "To add a workhorse: start a session on the `perlmutter` bridge and call `register_rc_workhorse`."
- **`SyncHealthPill`:** bridges only. Drop the "(rc)" suffix, since every row is now a bridge.
- **`StopAllWorkhorsesButton` and `RemoveWorkhorseButton`:** keep them, rewired.

## Verification (run all of these and report)
From `web/`:
- `npx prisma validate`
- `npx prisma generate`
- `npx tsc --noEmit`
- `npm test`

Plus:
- `cd tools/bridge-keeper && python3 -m unittest`
- `rg -n "sync\.py|host-sync|/api/mcp/sync|workhorse-bootstrap|tmuxAlive|lastClaudeBeat|sessionName|queue_directive|dispatch_workhorse_session|start_session|revive_session|stop_session"`, which must return nothing outside `docs/specs/` and `prisma/migrations/`.
- Copy `/home/murnanedaniel/Research/ScienceDash/web/dev.db` to `/tmp/` and run `DATABASE_URL=file:/tmp/<copy> npx prisma migrate deploy` against the copy. **Never touch the original.** Report the Workhorse row counts before and after.

No new dependencies. Do not commit.
