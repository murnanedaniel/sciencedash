import path from "node:path";
import os from "node:os";

/**
 * Deployment-specific configuration, read from the environment with safe
 * generic defaults so a fresh public clone runs without code edits. Server
 * code only — these read process.env and the filesystem layout.
 */

/**
 * Auto-deploy (the pull-from-origin/main timer + /settings widget) is
 * author-specific operational tooling that assumes a git checkout with CI.
 * It's OFF unless explicitly enabled, so a public clone never hits it.
 */
export function autoDeployEnabled(): boolean {
  const v = process.env.SCIENCEDASH_AUTO_DEPLOY_ENABLED;
  return v === "1" || v === "true";
}

/**
 * The web terminal (a real PTY-backed shell reachable from the dashboard)
 * is OFF unless explicitly enabled. It's meant for one specific pain: the
 * dashboard runs the local `claude` binary for every AI feature, and when
 * that login expires you need shell access to the box to run
 * `claude setup-token` — but you may only be able to reach the box through
 * the dashboard (Tailscale) with no SSH. This exposes an interactive shell
 * as the server user, so it stays behind an explicit opt-in and a fresh
 * public clone never ships a shell.
 *
 * Note: an authenticated user can already run arbitrary commands via the
 * chat surface's auto-approved Bash tool, so this is a more direct handle
 * on a capability that already exists behind the same auth — not a new
 * trust boundary. It's still gated so it's an intentional choice, not a
 * default.
 */
export function terminalEnabled(): boolean {
  const v = process.env.SCIENCEDASH_TERMINAL_ENABLED;
  return v === "1" || v === "true";
}

/**
 * Absolute path to the repo root on disk. The Next app runs with cwd=web/,
 * so the repo root is its parent by default. Override SCIENCEDASH_REPO_ROOT
 * for unusual layouts.
 */
export function repoRoot(): string {
  return process.env.SCIENCEDASH_REPO_ROOT ?? path.resolve(process.cwd(), "..");
}

/** owner/repo slug for CI status lookups via `gh`. Null disables the check. */
export function repoSlug(): string | null {
  return process.env.SCIENCEDASH_REPO_SLUG?.trim() || null;
}

/** Where runtime state lives (last-deploy marker, deploy.log, workhorse auth). */
export function stateDir(): string {
  return (
    process.env.SCIENCEDASH_STATE_DIR ??
    path.join(os.homedir(), ".sciencedash")
  );
}

/** The deploy script the auto-deploy timer / manual trigger invokes. */
export function deployScript(): string {
  return path.join(repoRoot(), "tools", "auto-deploy", "deploy.sh");
}
