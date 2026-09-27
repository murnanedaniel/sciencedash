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
 * The web terminal is a real PTY-backed shell reachable from the dashboard
 * at /terminal. It's meant for one specific pain: the dashboard runs the
 * local `claude` binary for every AI feature, and when that login expires
 * you need shell access to the box to run `claude setup-token` — but you may
 * only be able to reach the box through the dashboard (Tailscale) with no
 * SSH.
 *
 * It's ON by default; set SCIENCEDASH_TERMINAL_ENABLED=0 (or "false") to
 * opt out. An authenticated user can already run arbitrary commands via the
 * chat surface's auto-approved Bash tool, so this is a more direct handle on
 * a capability that already exists behind the same auth — not a new trust
 * boundary. Auth is still enforced by proxy.ts on every route.
 */
export function terminalEnabled(): boolean {
  const v = process.env.SCIENCEDASH_TERMINAL_ENABLED;
  return v !== "0" && v !== "false";
}

/**
 * The forum is a multi-party conversation surface: the user plus two or more
 * AI participants (Claude via the Agent SDK, Codex via `codex exec`) talking
 * to each other, with the user watching and able to interject.
 *
 * ON by default; set SCIENCEDASH_FORUM_ENABLED=0 to opt out. Participants get
 * a read-and-research tool surface only (no Write/Edit/Bash, codex sandboxed
 * read-only), so this is strictly narrower than the chat surface that's
 * already exposed behind the same auth.
 */
export function forumEnabled(): boolean {
  const v = process.env.SCIENCEDASH_FORUM_ENABLED;
  return v !== "0" && v !== "false";
}

/**
 * Default model ids for new forum participants. Deliberately env-driven
 * rather than hardcoded: model tiers turn over far faster than this code
 * does, and changing which tier debates should not require a deploy.
 */
export function forumClaudeModel(): string {
  return process.env.SCIENCEDASH_FORUM_CLAUDE_MODEL?.trim() || "claude-opus-5-5";
}

export function forumCodexModel(): string {
  return process.env.SCIENCEDASH_FORUM_CODEX_MODEL?.trim() || "gpt-6-astra";
}

/** The `codex` executable driving Codex participants. */
export function codexBin(): string {
  return process.env.SCIENCEDASH_CODEX_BIN?.trim() || "codex";
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

/** Where forum uploads and other durable per-forum state live. */
export function forumStateDir(): string {
  return path.join(stateDir(), "forum");
}

/** The deploy script the auto-deploy timer / manual trigger invokes. */
export function deployScript(): string {
  return path.join(repoRoot(), "tools", "auto-deploy", "deploy.sh");
}
