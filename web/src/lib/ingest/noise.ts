// Sessions we never ingest: ScienceDash's own spawned agent runs (brain
// heartbeats, /chat, quickstart, critical-review) execute in ephemeral temp
// dirs, so they're noise for "find my conversations". Real interactive work
// happens in project repos or home. Keep this in sync with ship.py's list.
const NOISE_CWD_PREFIXES = ["/tmp", "/var/tmp", "/private/tmp", "/private/var/folders"];

export function isNoiseCwd(cwd: string | null | undefined): boolean {
  if (!cwd) return false;
  const c = cwd.trim();
  if (!c) return false;
  return NOISE_CWD_PREFIXES.some((p) => c === p || c.startsWith(p + "/"));
}
