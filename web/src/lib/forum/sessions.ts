/**
 * Forum runtime: the live scheduler behind a multi-party conversation.
 *
 * Shape note — why this is a process-global registry and not a per-request
 * stream like /api/chat/stream: a forum keeps running while nobody is
 * watching, and more than one viewer can attach to the same conversation.
 * Both of those break a request-scoped design. This follows the pattern
 * `server/terminalSessions.ts` already established for PTYs: a singleton map
 * stashed on globalThis (so Next's dev HMR doesn't orphan running loops), a
 * fan-out `Set` of subscribers, and explicit lifecycle.
 *
 * Source of truth: the `ForumMessage` table, not memory. Each participant's
 * driver-side tape (SDK session / codex thread) is a lossy projection of it,
 * built by relaying the turns that participant hasn't seen yet. That's why a
 * "resync" is simply clearing `sessionRef` — the next turn then replays the
 * whole transcript into a fresh session.
 *
 * Turn-taking is deterministic and lives here, not in a moderator model:
 * whoever was last @-addressed speaks next, otherwise round-robin by seat.
 * `@human` parks the forum. The turn budget is the spend guard — two agents
 * left alone will talk until the credits run out.
 */

import { prisma } from "@/lib/prisma";
import { renderUntrustedMarkdown } from "@/lib/markdown";
import { forumStateDir } from "@/lib/config";
import { claudeDriver } from "@/lib/forum/drivers/claude";
import { codexDriver } from "@/lib/forum/drivers/codex";
import { buildForumSystemPrompt } from "@/lib/forum/prompt";
import {
  TURN_WALL_CLOCK_MS,
  type ForumTurnEvent,
  type ParticipantDriver,
} from "@/lib/forum/types";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, stat } from "node:fs/promises";

/**
 * Bounds on a forum's turn budget, shared by creation and later edits so the
 * two can't drift apart. The ceiling is the spend guard's guard: even a
 * deliberately long debate stops for the human eventually.
 */
export const MIN_TURN_BUDGET = 1;
export const MAX_TURN_BUDGET = 40;

export function clampTurnBudget(n: number): number {
  return Math.min(MAX_TURN_BUDGET, Math.max(MIN_TURN_BUDGET, Math.floor(n)));
}

/* ------------------------------ wire types ------------------------------ */

export type ForumMessageDTO = {
  id: string;
  idx: number;
  author: string;
  role: "human" | "agent" | "system";
  text: string;
  /**
   * `text` rendered as sanitised HTML (see renderUntrustedMarkdown). Rendered
   * here rather than in the browser so marked stays out of the client bundle,
   * matching <MarkdownBody>. Null for system messages, which stay plain.
   */
  html: string | null;
  events: ForumTurnEvent[];
  costUsd: number | null;
  addressed: string | null;
  createdAt: string;
};

export type ForumStreamEvent =
  /** A participant is about to speak. */
  | { kind: "turn_start"; handle: string }
  /** Live event from inside an in-flight turn. */
  | { kind: "turn_event"; handle: string; event: ForumTurnEvent }
  /** A message was committed to the transcript. */
  | { kind: "message"; message: ForumMessageDTO }
  /** Forum-level state changed. */
  | {
      kind: "status";
      status: string;
      turnsSpent: number;
      turnBudget: number;
      costUsd: number;
      /** Why the scheduler stopped, when it did. Rendered as a hint. */
      note?: string;
    };

/* ------------------------------- registry ------------------------------- */

type ForumRuntime = {
  forumId: string;
  subscribers: Set<(e: ForumStreamEvent) => void>;
  /** Aborts the turn currently in flight (human barge-in, pause, end). */
  turnAbort: AbortController | null;
  /**
   * Set when a *human* aborted the turn in flight (interject, pause, stop,
   * end) rather than the turn failing on its own. Without this the driver's
   * "aborted" error is indistinguishable from a real failure, and an
   * interjection would park the forum with a bogus "failed to respond"
   * instead of being answered.
   */
  interrupted: boolean;
  /** True while the scheduler loop is alive; guards against double-starts. */
  looping: boolean;
  /** Handle currently speaking, for late subscribers. */
  speaking: string | null;
};

type Registry = {
  forums: Map<string, ForumRuntime>;
  /**
   * When this server process first loaded the registry. A forum still marked
   * `running` whose last update predates this can only have been orphaned by
   * a restart — see reconcileStale().
   */
  bootedAt?: Date;
};

const g = globalThis as unknown as { __sd_forum__?: Registry };
const registry: Registry = (g.__sd_forum__ ??= { forums: new Map() });
registry.bootedAt ??= new Date();

/** Bound on forums running turns at once — each one drives real subprocesses. */
const MAX_LIVE_FORUMS = 3;
/**
 * Cap on a single tool payload (tool input, tool result, reasoning) as
 * streamed and stored. A WebFetch result is a whole page; storing it on every
 * turn would bloat the transcript for no reader. Prose is never clamped.
 */
const MAX_EVENT_CHARS = 8000;

function runtimeFor(forumId: string): ForumRuntime {
  let rt = registry.forums.get(forumId);
  if (!rt) {
    rt = {
      forumId,
      subscribers: new Set(),
      turnAbort: null,
      interrupted: false,
      looping: false,
      speaking: null,
    };
    registry.forums.set(forumId, rt);
  }
  return rt;
}

function emit(forumId: string, e: ForumStreamEvent): void {
  const rt = registry.forums.get(forumId);
  if (!rt) return;
  for (const sub of rt.subscribers) {
    try {
      sub(e);
    } catch {
      // one dead subscriber must not break the fan-out
    }
  }
}

/** Attach a live listener. Returns the unsubscribe function. */
export function subscribe(
  forumId: string,
  cb: (e: ForumStreamEvent) => void,
): () => void {
  const rt = runtimeFor(forumId);
  rt.subscribers.add(cb);
  return () => {
    rt.subscribers.delete(cb);
    // Keep the runtime alive if a loop is still running — the forum
    // continues whether or not anyone is watching.
    if (rt.subscribers.size === 0 && !rt.looping) {
      registry.forums.delete(forumId);
    }
  };
}

/** What a late subscriber needs to render the current in-flight state. */
export function liveState(forumId: string): { speaking: string | null } {
  const rt = registry.forums.get(forumId);
  return { speaking: rt?.speaking ?? null };
}

/* -------------------------------- helpers -------------------------------- */

const DRIVERS: Record<string, ParticipantDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
};

function toDTO(m: {
  id: string;
  idx: number;
  author: string;
  role: string;
  text: string;
  eventsJson: string | null;
  costUsd: number | null;
  addressed: string | null;
  createdAt: Date;
}): ForumMessageDTO {
  let events: ForumTurnEvent[] = [];
  if (m.eventsJson) {
    try {
      const parsed = JSON.parse(m.eventsJson);
      if (Array.isArray(parsed)) events = parsed as ForumTurnEvent[];
    } catch {
      events = [];
    }
  }
  return {
    id: m.id,
    idx: m.idx,
    author: m.author,
    role: m.role as "human" | "agent" | "system",
    text: m.text,
    html: m.role === "system" ? null : renderUntrustedMarkdown(m.text),
    events,
    costUsd: m.costUsd,
    addressed: m.addressed,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Full transcript, oldest first. */
export async function loadTranscript(forumId: string): Promise<ForumMessageDTO[]> {
  const rows = await prisma.forumMessage.findMany({
    where: { forumId },
    orderBy: { idx: "asc" },
  });
  return rows.map(toDTO);
}

/**
 * Which @mention decides who speaks next depends on who wrote it.
 *
 *  - Agents hand off at the END of a turn ("…what do you reckon, @codex?"),
 *    while their earlier mentions are references to what someone said — so
 *    the LAST mention wins.
 *  - People lead with who they want ("@claude go first, then @codex"), so
 *    for the human the FIRST mention wins. Using "last" here once sent a
 *    turn to @codex, who spent it saying "@claude, you're up first".
 */
function parseAddressed(
  text: string,
  knownHandles: string[],
  pick: "first" | "last",
): string | null {
  const valid = new Set([...knownHandles, "human"]);
  let found: string | null = null;
  for (const m of text.matchAll(/@([a-z0-9_-]+)/gi)) {
    const h = m[1].toLowerCase();
    if (!valid.has(h)) continue;
    if (pick === "first") return h;
    found = h;
  }
  return found;
}

/** Prisma's unique-constraint violation (here: two writers took the same idx). */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/**
 * Append a message and return it, assigning the next idx. The idx is read
 * then written, so two concurrent appends (an interjection landing as a turn
 * commits) can pick the same one; the unique index rejects the loser, which
 * simply re-reads and retries.
 */
async function appendMessage(
  forumId: string,
  data: {
    author: string;
    role: "human" | "agent" | "system";
    text: string;
    events?: ForumTurnEvent[];
    costUsd?: number | null;
    addressed?: string | null;
  },
): Promise<ForumMessageDTO> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const last = await prisma.forumMessage.findFirst({
      where: { forumId },
      orderBy: { idx: "desc" },
      select: { idx: true },
    });
    try {
      const row = await prisma.forumMessage.create({
        data: {
          forumId,
          idx: (last?.idx ?? -1) + 1,
          author: data.author,
          role: data.role,
          text: data.text,
          eventsJson: data.events?.length
            ? JSON.stringify(data.events)
            : null,
          costUsd: data.costUsd ?? null,
          addressed: data.addressed ?? null,
        },
      });
      const dto = toDTO(row);
      emit(forumId, { kind: "message", message: dto });
      return dto;
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error;
    }
  }
  throw new Error("failed to append forum message");
}

/**
 * The one place a failure is reported. It becomes a system message — in the
 * transcript even if nobody was watching, and streamed live like any other
 * message — plus a line in the service log: the codebase barely logs, but a
 * failure with no witness has to leave a trace somewhere you'd look.
 */
async function recordFailure(forumId: string, text: string): Promise<void> {
  await appendMessage(forumId, {
    author: "system",
    role: "system",
    text,
  });
  console.error(`[forum ${forumId}] ${text}`);
}

async function emitStatus(forumId: string, note?: string): Promise<void> {
  const f = await prisma.forum.findUnique({
    where: { id: forumId },
    select: { status: true, turnsSpent: true, turnBudget: true, costUsd: true },
  });
  if (!f) return;
  emit(forumId, {
    kind: "status",
    status: f.status,
    turnsSpent: f.turnsSpent,
    turnBudget: f.turnBudget,
    costUsd: f.costUsd,
    ...(note ? { note } : {}),
  });
}

/** Truncate an oversized payload to MAX_EVENT_CHARS, noting the original size. */
function clampValue(value: unknown): unknown {
  let serialized: string;
  if (typeof value === "string") {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = String(value);
    }
  }
  if (serialized.length <= MAX_EVENT_CHARS) return value;
  return (
    serialized.slice(0, MAX_EVENT_CHARS) +
    `\n…[truncated — ${serialized.length} chars total]`
  );
}

function clampEvent(event: ForumTurnEvent): ForumTurnEvent {
  switch (event.kind) {
    case "reasoning":
      return { ...event, text: clampValue(event.text) as string };
    case "tool_use":
      return { ...event, input: clampValue(event.input) };
    case "tool_result":
      return { ...event, content: clampValue(event.content) };
    default:
      return event;
  }
}

/**
 * Build the input for one participant's turn: everything said since that
 * participant last spoke, prefixed with who said it.
 *
 * When `sessionRef` is null the participant has no tape on the driver side
 * (first turn, or a resync), so the whole transcript is replayed instead.
 * That's the only place full history is sent, and it's what makes "resync"
 * work by simply clearing `sessionRef`.
 */
function buildRelay(
  transcript: ForumMessageDTO[],
  selfHandle: string,
  hasSession: boolean,
): string {
  let slice = transcript;
  if (hasSession) {
    const lastOwn = transcript.map((m) => m.author).lastIndexOf(selfHandle);
    slice = lastOwn === -1 ? transcript : transcript.slice(lastOwn + 1);
  }
  const lines = slice
    .filter((m) => m.author !== selfHandle && m.text.trim())
    .map((m) => `@${m.author}: ${m.text.trim()}`);

  if (lines.length === 0) {
    return "(No new messages. Open the discussion.)";
  }
  const body = lines.join("\n\n");
  return hasSession
    ? body
    : `Here is the conversation so far.\n\n${body}`;
}

/**
 * Pick who speaks next.
 *  - Explicit @address wins (and `@human` parks the forum).
 *  - Otherwise round-robin by seat, starting after whoever spoke last.
 */
function pickNextSpeaker(
  transcript: ForumMessageDTO[],
  participants: Array<{ handle: string; seat: number; active: boolean }>,
): { handle: string } | { park: string } {
  const active = participants
    .filter((p) => p.active)
    .sort((a, b) => a.seat - b.seat);
  if (active.length === 0) return { park: "no active participants" };

  const last = transcript[transcript.length - 1];
  if (!last) return { handle: active[0].handle };

  if (last.addressed === "human") {
    return { park: `@${last.author} handed back to you` };
  }
  if (last.addressed) {
    const target = active.find((p) => p.handle === last.addressed);
    if (target) return { handle: target.handle };
  }

  // Round-robin from whoever spoke last.
  const lastIdx = active.findIndex((p) => p.handle === last.author);
  if (lastIdx === -1) return { handle: active[0].handle };
  return { handle: active[(lastIdx + 1) % active.length].handle };
}

/**
 * Every participant turn runs in this one scratch dir. It must be stable: the
 * Claude SDK derives its session-storage path from a hash of cwd, so a
 * per-turn temp dir would make `resume: <sessionId>` unable to find the prior
 * tape. And it must be under /tmp: the transcript ingester treats /tmp cwds as
 * noise, which keeps forum-agent sessions out of Conversations search.
 */
async function forumCwd(): Promise<string> {
  const dir = join(tmpdir(), "sciencedash-forum");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Where a forum's uploads live. In the state dir rather than the repo: they
 * are the user's files, not source, and must survive a checkout reset.
 */
export function forumAttachmentsDir(forumId: string): string {
  return join(forumStateDir(), forumId, "attachments");
}

/**
 * The linked project's repo, if it exists on this machine. Participants are
 * told this path; they don't run in it (see prompt.ts for why).
 */
export async function resolveWorkdir(forum: {
  project?: { localPath: string | null } | null;
}): Promise<string | null> {
  const localPath = forum.project?.localPath?.trim();
  if (!localPath) return null;
  try {
    return (await stat(localPath)).isDirectory() ? localPath : null;
  } catch {
    return null;
  }
}

/**
 * Why a forum is sitting still, derived from state so a page reload can
 * still explain it (the live `status` note is gone by then).
 */
export function parkNote(
  f: { status: string; turnsSpent: number; turnBudget: number },
  last: { author: string; addressed: string | null } | null,
): string | null {
  if (f.status === "ended") return "ended";
  if (f.status === "paused") return "paused";
  if (f.status === "idle" && f.turnsSpent >= f.turnBudget) {
    return "turn budget spent — say something to continue";
  }
  if (f.status === "idle" && last?.addressed === "human") {
    return `@${last.author} handed back to you`;
  }
  return null;
}

/* ------------------------------- scheduler ------------------------------- */

/**
 * Run one participant's turn end to end: compose, drive, persist.
 * Returns false if the forum should stop looping.
 */
async function runTurn(forumId: string, handle: string): Promise<boolean> {
  const rt = runtimeFor(forumId);
  const forum = await prisma.forum.findUnique({
    where: { id: forumId },
    include: {
      participants: true,
      project: { select: { localPath: true } },
    },
  });
  if (!forum) return false;

  const me = forum.participants.find((p) => p.handle === handle);
  if (!me) return false;

  const driver = DRIVERS[me.driver];
  if (!driver) {
    await appendMessage(forumId, {
      author: "system",
      role: "system",
      text: `No driver registered for "${me.driver}" — @${handle} cannot speak.`,
    });
    return false;
  }

  const transcript = await loadTranscript(forumId);
  const others = forum.participants
    .filter((p) => p.handle !== handle && p.active)
    .map((p) => p.handle);
  const workdir = await resolveWorkdir(forum);
  const attachmentsDir = forumAttachmentsDir(forumId);

  const systemPrompt = await buildForumSystemPrompt({
    selfHandle: handle,
    otherHandles: others,
    topic: forum.topic,
    persona: me.persona,
    projectId: forum.projectId,
    workdir,
    attachmentsDir,
  });

  const relay = buildRelay(transcript, handle, me.sessionRef !== null);

  // Turn-scoped abort: trips on human barge-in, pause/end, or wall clock.
  const ac = new AbortController();
  rt.turnAbort = ac;
  rt.interrupted = false;
  rt.speaking = handle;
  const timer = setTimeout(
    () => ac.abort(new Error("turn wall-clock timeout")),
    TURN_WALL_CLOCK_MS,
  );

  emit(forumId, { kind: "turn_start", handle });

  try {
    const result = await driver.speak(relay, {
      systemPrompt,
      model: me.model,
      cwd: await forumCwd(),
      sessionRef: me.sessionRef,
      signal: ac.signal,
      onEvent: (event) =>
        emit(forumId, {
          kind: "turn_event",
          handle,
          event: clampEvent(event),
        }),
    });
    const events = result.events.map(clampEvent);

    // Persist the resume handle even on a failed turn — the thread may well
    // exist driver-side, and losing the ref would silently fork the context.
    if (result.sessionRef && result.sessionRef !== me.sessionRef) {
      await prisma.forumParticipant.update({
        where: { id: me.id },
        data: { sessionRef: result.sessionRef },
      });
    }

    const handles = forum.participants.map((p) => p.handle);
    const text = result.text.trim();

    // Human-initiated abort: not a failure. Keep whatever was said before the
    // interruption, drop the driver's "aborted" error, and let the loop's
    // status check decide what happens next — an interjection leaves the
    // forum `running` (so the loop answers it), pause/end do not.
    if (rt.interrupted) {
      rt.interrupted = false;
      if (text) {
        await appendMessage(forumId, {
          author: handle,
          role: "agent",
          text,
          events,
          costUsd: result.costUsd,
          addressed: parseAddressed(text, handles, "last"),
        });
        if (result.costUsd) {
          await prisma.forum.update({
            where: { id: forumId },
            data: { costUsd: { increment: result.costUsd } },
          });
        }
      }
      return true;
    }

    if (!text && result.error) {
      const failure = `@${handle} failed to respond: ${result.error}`;
      await appendMessage(forumId, {
        author: "system",
        role: "system",
        text: failure,
        events,
      });
      console.error(`[forum ${forumId}] ${failure}`);
      // A failing participant parks the forum rather than letting the other
      // one monologue into the void.
      await prisma.forum.update({
        where: { id: forumId },
        data: { status: "idle" },
      });
      await emitStatus(forumId, `@${handle} errored — forum parked`);
      return false;
    }

    await appendMessage(forumId, {
      author: handle,
      role: "agent",
      text: text || "(no response)",
      events,
      costUsd: result.costUsd,
      addressed: parseAddressed(text, handles, "last"),
    });

    await prisma.forum.update({
      where: { id: forumId },
      data: {
        turnsSpent: { increment: 1 },
        ...(result.costUsd ? { costUsd: { increment: result.costUsd } } : {}),
      },
    });

    if (result.error) {
      await recordFailure(
        forumId,
        `@${handle}'s turn ended with an error: ${result.error}`,
      );
    }
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? "unknown");
    await recordFailure(forumId, `@${handle}'s turn failed: ${message}`);
    await prisma.forum.update({
      where: { id: forumId },
      data: { status: "idle" },
    });
    return false;
  } finally {
    clearTimeout(timer);
    rt.turnAbort = null;
    rt.speaking = null;
  }
}

/**
 * The scheduler loop. Runs detached from any HTTP request — a forum keeps
 * talking whether or not a browser is attached.
 */
async function loop(forumId: string): Promise<void> {
  const rt = runtimeFor(forumId);
  if (rt.looping) return;

  const liveCount = [...registry.forums.values()].filter((r) => r.looping).length;
  if (liveCount >= MAX_LIVE_FORUMS) {
    const message =
      `too many forums running at once (max ${MAX_LIVE_FORUMS}); ` +
      "pause one first";
    await prisma.forum.update({
      where: { id: forumId },
      data: { status: "idle" },
    });
    await recordFailure(forumId, message);
    await emitStatus(forumId, message);
    return;
  }

  rt.looping = true;
  try {
    for (;;) {
      const forum = await prisma.forum.findUnique({
        where: { id: forumId },
        include: { participants: true },
      });
      if (!forum || forum.status !== "running") break;

      if (forum.turnsSpent >= forum.turnBudget) {
        await prisma.forum.update({
          where: { id: forumId },
          data: { status: "idle" },
        });
        await emitStatus(
          forumId,
          `turn budget spent (${forum.turnBudget}) — say something to continue`,
        );
        break;
      }

      const transcript = await loadTranscript(forumId);
      const next = pickNextSpeaker(transcript, forum.participants);
      if ("park" in next) {
        await prisma.forum.update({
          where: { id: forumId },
          data: { status: "idle" },
        });
        await emitStatus(forumId, next.park);
        break;
      }

      const ok = await runTurn(forumId, next.handle);
      if (!ok) {
        // Some failure paths (missing participant, unknown driver) return
        // without touching status. Never leave a forum showing `running` with
        // no loop behind it.
        await prisma.forum.updateMany({
          where: { id: forumId, status: "running" },
          data: { status: "idle" },
        });
      }
      await emitStatus(forumId);
      if (!ok) break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? "unknown");
    await prisma.forum
      .update({ where: { id: forumId }, data: { status: "idle" } })
      .catch(() => {});
    await recordFailure(forumId, `scheduler error: ${message}`).catch(() => {});
    await emitStatus(forumId, "scheduler error — forum parked");
  } finally {
    rt.looping = false;
    if (rt.subscribers.size === 0) registry.forums.delete(forumId);
  }
}

/** Start the loop if it isn't already running. Never awaits the loop. */
function kick(forumId: string): void {
  void loop(forumId);
}

/* --------------------------------- API ---------------------------------- */

/**
 * Park forums orphaned by a server restart. Status lives in the DB but the
 * loop lives in this process, so a restart mid-turn leaves a forum showing
 * `running` with nothing driving it. Only forums last touched before this
 * process booted qualify: a forum set running a moment ago whose loop hasn't
 * started yet must not be mistaken for one. updateMany is the atomic claim, so
 * two concurrent callers can't both post the notice.
 */
export async function reconcileStale(forumId?: string): Promise<void> {
  const bootedAt = registry.bootedAt ?? new Date(0);
  const stale = await prisma.forum.findMany({
    where: {
      status: "running",
      updatedAt: { lt: bootedAt },
      ...(forumId ? { id: forumId } : {}),
    },
    select: { id: true },
  });

  for (const forum of stale) {
    if (registry.forums.get(forum.id)?.looping) continue;
    const { count } = await prisma.forum.updateMany({
      where: { id: forum.id, status: "running" },
      data: { status: "idle" },
    });
    if (count === 0) continue;
    await appendMessage(forum.id, {
      author: "system",
      role: "system",
      text: "The server restarted while this forum was running, so it has been parked. Send a message or press Resume to continue.",
    });
    await emitStatus(forum.id);
  }
}

/**
 * Tell the room a file arrived. A system message rather than UI-only state:
 * system messages are relayed to participants, so this is how they learn the
 * file exists and where to read it.
 */
export async function announceAttachment(
  forumId: string,
  name: string,
  absPath: string,
  size: number,
): Promise<void> {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const readable = unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
  await appendMessage(forumId, {
    author: "system",
    role: "system",
    text: `@human attached "${name}" (${readable}) — it is at ${absPath}`,
  });
}

/**
 * Human message. Resets the turn budget (the guard exists to stop *agents*
 * running away, not to ration the person), aborts any in-flight turn so the
 * interjection lands immediately, and restarts the loop.
 */
export async function postHumanMessage(
  forumId: string,
  text: string,
): Promise<ForumMessageDTO | null> {
  const forum = await prisma.forum.findUnique({
    where: { id: forumId },
    include: { participants: true },
  });
  if (!forum || forum.status === "ended") return null;

  const handles = forum.participants.map((p) => p.handle);
  const dto = await appendMessage(forumId, {
    author: "human",
    role: "human",
    text: text.trim(),
    addressed: parseAddressed(text, handles, "first"),
  });

  // Barge-in: kill the turn in flight so the human isn't queued behind it.
  const rt = runtimeFor(forumId);
  if (rt.turnAbort) {
    rt.interrupted = true;
    try {
      rt.turnAbort.abort(new Error("human interjected"));
    } catch {
      // ignore
    }
  }

  await prisma.forum.update({
    where: { id: forumId },
    data: { status: "running", turnsSpent: 0 },
  });
  await emitStatus(forumId);
  kick(forumId);
  return dto;
}

/**
 * Change the budget without starting, resuming, or pausing the forum. Raising
 * it on a parked forum still requires Resume or a human message; lowering it
 * below turnsSpent on a running forum parks it before the next turn.
 */
export async function setTurnBudget(
  forumId: string,
  value: number,
): Promise<{ ok: boolean; error?: string }> {
  const forum = await prisma.forum.findUnique({ where: { id: forumId } });
  if (!forum) return { ok: false, error: "no such forum" };
  if (forum.status === "ended") return { ok: false, error: "forum has ended" };

  const updated = await prisma.forum.update({
    where: { id: forumId },
    data: { turnBudget: clampTurnBudget(value) },
  });
  // Only nudge toward Resume when the budget is what parked the forum and the
  // new one frees it. A forum idle for another reason (brand new, or waiting
  // on "@human") isn't blocked by its budget, so the hint would mislead.
  const wasBudgetParked =
    forum.status === "idle" && forum.turnsSpent >= forum.turnBudget;
  await emitStatus(
    forumId,
    wasBudgetParked && updated.turnsSpent < updated.turnBudget
      ? "budget raised — press Resume to continue"
      : undefined,
  );
  return { ok: true };
}

export type ForumControl = "pause" | "resume" | "abort" | "end" | "resync";

export async function control(
  forumId: string,
  action: ForumControl,
): Promise<{ ok: boolean; error?: string }> {
  const forum = await prisma.forum.findUnique({ where: { id: forumId } });
  if (!forum) return { ok: false, error: "no such forum" };

  const rt = runtimeFor(forumId);
  const abortInFlight = (reason: string) => {
    if (rt.turnAbort) {
      // Human-initiated, so runTurn keeps any partial text and doesn't
      // report the abort as a participant failure.
      rt.interrupted = true;
      try {
        rt.turnAbort.abort(new Error(reason));
      } catch {
        // ignore
      }
    }
  };

  switch (action) {
    case "pause":
      await prisma.forum.update({
        where: { id: forumId },
        data: { status: "paused" },
      });
      abortInFlight("paused");
      await emitStatus(forumId, "paused");
      return { ok: true };

    case "resume":
      if (forum.status === "ended") {
        return { ok: false, error: "forum has ended" };
      }
      await prisma.forum.update({
        where: { id: forumId },
        data: { status: "running", turnsSpent: 0 },
      });
      await emitStatus(forumId, "resumed");
      kick(forumId);
      return { ok: true };

    case "abort":
      // Stop the current turn but leave the forum where it is.
      abortInFlight("aborted by human");
      await prisma.forum.update({
        where: { id: forumId },
        data: { status: "idle" },
      });
      await emitStatus(forumId, "turn aborted");
      return { ok: true };

    case "end":
      await prisma.forum.update({
        where: { id: forumId },
        data: { status: "ended", endedAt: new Date() },
      });
      abortInFlight("forum ended");
      await emitStatus(forumId, "ended");
      return { ok: true };

    case "resync":
      // Drop every driver-side tape. The next turn for each participant
      // replays the full transcript into a fresh session — the escape hatch
      // for when a participant has visibly lost the plot.
      await prisma.forumParticipant.updateMany({
        where: { forumId },
        data: { sessionRef: null },
      });
      await appendMessage(forumId, {
        author: "system",
        role: "system",
        text: "Participants resynced — each will re-read the full transcript on its next turn.",
      });
      return { ok: true };

    default:
      return { ok: false, error: `unknown action ${action}` };
  }
}
