# Spec: run ScienceDash in production mode (`next start`) with a build-then-swap deploy

## Why
The service runs `next dev`, so every route compiles on its first request after each restart. Users see a hanging "Compiling…" pill after every auto-deploy, and dev mode adds file-watching and cache overhead. Production mode serves pre-built routes.

## Design: two build slots, no downtime during the build
- **Slots:** builds alternate between two directories, `web/.next-a` and `web/.next-b`. The running server uses one; a deploy builds into the other, then restarts the service pointed at the new slot. A failed build leaves the running server untouched.
- **Active slot:** recorded in `$STATE_DIR/sciencedash-runtime.env` (default `~/.sciencedash/sciencedash-runtime.env`) as one line, `SCIENCEDASH_DIST_DIR=.next-a` or `.next-b`. The systemd unit loads this with `EnvironmentFile=`.
- **No renaming:** a slot directory is never renamed after it's built, because Next records distDir in the build output.

## Changes
1. **`web/next.config.ts`:**
   - Add `distDir: process.env.SCIENCEDASH_DIST_DIR || ".next"`, so plain `next dev` and `next build` keep working.
   - Add `experimental.serverActions.allowedOrigins` from the same list as `allowedDevOrigins` (localhost, 127.0.0.1, plus the comma-separated `SCIENCEDASH_ALLOWED_DEV_ORIGINS`). Server actions must keep working behind the reverse proxies (Tailscale Funnel, cloudflared) in production. Check the Next 16 docs and types in node_modules for the exact config key and shape.
   - Keep `allowedDevOrigins` as is.
2. **`web/src/instrumentation.ts`:** if `process.env.SCIENCEDASH_WORKER === "0"`, don't call `startWorker()`, and log a single line saying so. This lets test instances run without background ticks.
3. **`tools/auto-deploy/deploy.sh`:**
   - **Build step:** after `prisma generate` and before the restart, pick the inactive slot: the other one if the env file names one, otherwise `.next-a`. Remove any stale copy of that slot, then build with `SCIENCEDASH_DIST_DIR=<slot> timeout 1200 npx next build >> "$LOG" 2>&1`.
     - **On failure:** log `ERROR: next build failed — keeping current server`, exit 1, and do not restart. The working tree is already at the new SHA, and that's acceptable.
     - **On success:** write the env file atomically (write a temp file, then `mv`), then restart.
   - **Bootstrap rule:** near the top, after `cd` and the branch check, handle the case where `HEAD == origin/main` but there's no env file, or the active slot has no `BUILD_ID`. In that case, log it and fall through to build plus restart **without** the CI and pull steps. The first switch to production mode then happens automatically.
   - **Bootstrap build failure:** if the bootstrap build fails, don't restart, and don't retry on every tick. Write `$STATE_DIR/build-failed-<sha>` and skip while that file exists for the current SHA.
   - Update the header comment to describe the new flow.
4. **New `tools/auto-deploy/sciencedash.service`:** the repo copy of the production unit, modelled on the current installed one (below).
   - Description: "ScienceDash dashboard (Next.js production server)"
   - `Environment=NODE_ENV=production`
   - `EnvironmentFile=-%h/.sciencedash/sciencedash-runtime.env`
   - `ExecStart=%h/.local/share/fnm/aliases/default/bin/npm run start -- -p 3000`
   - `Restart=on-failure`, `RestartSec=5`, and the same PATH, WorkingDirectory and log lines.
   - Update `tools/auto-deploy/install.sh` and its comments to install it, and mention it in the README or docs where the dev-server unit is described.

   The current installed unit, for reference:
   ```
   WorkingDirectory=%h/Research/ScienceDash/web
   Environment=PATH=%h/.local/share/fnm/aliases/default/bin:%h/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
   ExecStart=%h/.local/share/fnm/aliases/default/bin/npm run dev -- -p 3000
   Restart=on-failure
   RestartSec=5
   StandardOutput=append:%h/.config/systemd/user/sciencedash.log
   StandardError=append:%h/.config/systemd/user/sciencedash.log
   ```
5. **`.gitignore`:** add `web/.next-a/` and `web/.next-b/`, or a general `.next*/` pattern.

## Verification (Codex)
- `npx tsc --noEmit` and `npm test` from `web/`.
- `bash -n tools/auto-deploy/deploy.sh`.
- `SCIENCEDASH_DIST_DIR=.next-a npx next build` must succeed with dummy auth env vars, like CI.

Do not commit. Don't touch the production checkout (`/home/murnanedaniel/Research/ScienceDash`), the running services, or `~/.sciencedash`.
