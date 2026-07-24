/**
 * Server-side registry of live PTY sessions for the web terminal.
 *
 * Why this exists: the dashboard drives the local `claude` binary for every
 * AI feature. When that login expires you need a shell on the box to run
 * `claude setup-token` — but the box may only be reachable through the
 * dashboard (Tailscale), with no SSH. This module owns the actual pseudo-
 * terminal subprocesses so the HTTP routes can stay thin.
 *
 * Transport shape (no WebSocket — `next start` doesn't expose the upgrade
 * handler through route handlers): output is pushed to subscribers that the
 * SSE `/stream` route registers; input/resize arrive as ordinary POSTs.
 * A rolling output buffer lets a page refresh or reconnect replay the
 * current scrollback instead of staring at a blank screen.
 *
 * Lifetime: sessions are held in a process-global map (stashed on globalThis
 * so Next's dev HMR doesn't orphan running shells). They die on: explicit
 * kill, the shell exiting, or an idle timeout. A hard cap bounds how many
 * shells can be alive at once.
 *
 * This is gated behind `terminalEnabled()` at every route; nothing here
 * spawns a process unless a route that already checked the flag asks it to.
 */

import { randomUUID } from "node:crypto";

/** Minimal shape of the bits of node-pty's IPty we use. */
type IPty = {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
};

type PtyModule = {
  spawn: (
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string | undefined>;
    },
  ) => IPty;
};

export type TerminalSession = {
  id: string;
  pty: IPty;
  /** Rolling capture of recent output, replayed to new subscribers. */
  buffer: string;
  /** Live output listeners (one per open SSE stream). */
  subscribers: Set<(chunk: string) => void>;
  /** Fired once when the shell exits, so streams can close cleanly. */
  exitListeners: Set<(info: { exitCode: number; signal?: number }) => void>;
  exited: boolean;
  exitInfo: { exitCode: number; signal?: number } | null;
  createdAt: number;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

/** Keep roughly this many bytes of scrollback for replay on reconnect. */
const MAX_BUFFER_BYTES = 256 * 1024;
/** Kill a session after this long with no input or output. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Never run more than this many shells at once. */
const MAX_SESSIONS = 4;

type Registry = { sessions: Map<string, TerminalSession> };

// Stash on globalThis so Next's dev-mode module reloading doesn't leak
// orphaned shells across HMR. In production `next start` this is a plain
// singleton in the one server process.
const g = globalThis as unknown as { __sd_terminal__?: Registry };
const registry: Registry = (g.__sd_terminal__ ??= { sessions: new Map() });

let cachedPtyModule: PtyModule | null | undefined;

/**
 * Load node-pty lazily. It's a native module; a public clone that never
 * enables the terminal shouldn't need it installed. Returns null with a
 * readable reason if it isn't available.
 */
async function loadPty(): Promise<PtyModule> {
  if (cachedPtyModule) return cachedPtyModule;
  try {
    // Indirect specifier so the bundler leaves this as a runtime require of
    // the native module (also in next.config serverExternalPackages).
    const mod = (await import("node-pty")) as unknown as
      | PtyModule
      | { default: PtyModule };
    cachedPtyModule =
      "spawn" in mod ? (mod as PtyModule) : (mod as { default: PtyModule }).default;
    return cachedPtyModule;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `node-pty is not available — install it in web/ to use the terminal (${detail})`,
    );
  }
}

function touch(session: TerminalSession) {
  session.lastActivity = Date.now();
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    kill(session.id);
  }, IDLE_TIMEOUT_MS);
}

/**
 * Choose the shell to spawn. Honour SHELL when set; fall back to bash then
 * sh. `-l` gives a login shell so the user's PATH (and thus a
 * `~/.local/bin/claude`) is present, matching an interactive SSH session.
 */
function resolveShell(): { file: string; args: string[] } {
  const shell = process.env.SHELL;
  if (shell) return { file: shell, args: ["-l"] };
  return { file: "/bin/bash", args: ["-l"] };
}

export type CreateResult =
  | { ok: true; id: string; pid: number }
  | { ok: false; error: string };

export async function createSession(opts?: {
  cols?: number;
  rows?: number;
}): Promise<CreateResult> {
  if (registry.sessions.size >= MAX_SESSIONS) {
    return {
      ok: false,
      error: `too many terminal sessions open (max ${MAX_SESSIONS}); close one first`,
    };
  }

  let ptyMod: PtyModule;
  try {
    ptyMod = await loadPty();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const { file, args } = resolveShell();
  const cols = clampDim(opts?.cols, 80);
  const rows = clampDim(opts?.rows, 24);

  let child: IPty;
  try {
    child = ptyMod.spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME ?? process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        // Mark the shell so login flows / prompts know they're inside the
        // dashboard terminal, and so it's greppable in process lists.
        SCIENCEDASH_TERMINAL: "1",
      },
    });
  } catch (e) {
    return {
      ok: false,
      error: `failed to spawn shell: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const id = randomUUID();
  const session: TerminalSession = {
    id,
    pty: child,
    buffer: "",
    subscribers: new Set(),
    exitListeners: new Set(),
    exited: false,
    exitInfo: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    idleTimer: null,
  };
  registry.sessions.set(id, session);

  child.onData((data) => {
    session.buffer += data;
    if (session.buffer.length > MAX_BUFFER_BYTES) {
      session.buffer = session.buffer.slice(
        session.buffer.length - MAX_BUFFER_BYTES,
      );
    }
    touch(session);
    for (const sub of session.subscribers) {
      try {
        sub(data);
      } catch {
        // a dead subscriber shouldn't kill the fan-out
      }
    }
  });

  child.onExit((info) => {
    session.exited = true;
    session.exitInfo = info;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    for (const cb of session.exitListeners) {
      try {
        cb(info);
      } catch {
        // ignore
      }
    }
    // Keep the session briefly so any attached stream can flush the exit,
    // then evict so a stale id can't be reused.
    setTimeout(() => registry.sessions.delete(id), 2000);
  });

  touch(session);
  return { ok: true, id, pid: child.pid };
}

export function getSession(id: string): TerminalSession | null {
  return registry.sessions.get(id) ?? null;
}

export function writeInput(id: string, data: string): boolean {
  const s = registry.sessions.get(id);
  if (!s || s.exited) return false;
  try {
    s.pty.write(data);
  } catch {
    return false;
  }
  touch(s);
  return true;
}

export function resize(id: string, cols: number, rows: number): boolean {
  const s = registry.sessions.get(id);
  if (!s || s.exited) return false;
  try {
    s.pty.resize(clampDim(cols, 80), clampDim(rows, 24));
  } catch {
    return false;
  }
  return true;
}

export function kill(id: string): boolean {
  const s = registry.sessions.get(id);
  if (!s) return false;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  try {
    s.pty.kill();
  } catch {
    // already gone
  }
  return true;
}

/** For a lightweight "are there live shells?" indicator if ever needed. */
export function sessionCount(): number {
  return registry.sessions.size;
}

function clampDim(v: number | undefined, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  if (n < 1) return 1;
  if (n > 1000) return 1000;
  return n;
}
