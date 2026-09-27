/**
 * Forum participant driver interface.
 *
 * A forum is a conversation between the user and two or more AI participants
 * that are driven by completely different runtimes — Claude through the Agent
 * SDK (in-process), Codex through `codex exec` (a subprocess emitting JSONL).
 * The scheduler must not care which is which, so both are reduced to one
 * question: *given the conversation so far, say the next thing*.
 *
 * The shapes below are the whole contract. Everything driver-specific
 * (session resumption, tool wiring, sandbox policy, event vocabulary) lives
 * behind `speak()`.
 */

/**
 * A single observable thing that happened during one participant's turn.
 * Streamed to the UI live and persisted alongside the message text so a
 * reload can re-render what the participant actually did.
 *
 * Deliberately lossy and driver-agnostic: the Claude SDK and codex emit very
 * different event vocabularies, and the UI only needs enough to render
 * "thinking / called a tool / got a result / said something".
 */
export type ForumTurnEvent =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool_use"; name: string; input?: unknown }
  | { kind: "tool_result"; name?: string; content?: unknown; isError: boolean }
  | { kind: "error"; message: string };

/** What a driver returns once a turn is finished. */
export type ForumTurnResult = {
  /** The participant's prose — the only part relayed to other participants. */
  text: string;
  /**
   * Driver-side resume handle produced or reused by this turn (SDK
   * `session_id` / codex `thread_id`). Null if the driver never reported one.
   */
  sessionRef: string | null;
  /** Dollar cost where the driver reports it. Codex reports tokens, not USD. */
  costUsd: number | null;
  events: ForumTurnEvent[];
  /** Non-null if the turn failed. `text` may still hold a partial answer. */
  error: string | null;
};

/** Everything a driver needs to run one turn. */
export type DriverContext = {
  /** Fully composed system prompt — forum rules + persona + project brief. */
  systemPrompt: string;
  /** Model id, passed through verbatim. Tiers change faster than code does. */
  model: string;
  /** Working directory for the participant's tools. */
  cwd: string;
  /** Resume handle from this participant's previous turn, if any. */
  sessionRef: string | null;
  /** Trips on human barge-in, forum end, or the turn's wall-clock timeout. */
  signal: AbortSignal;
  /** Called as events arrive so the SSE stream can forward them live. */
  onEvent: (event: ForumTurnEvent) => void;
};

export interface ParticipantDriver {
  /** Matches `ForumParticipant.driver`. */
  readonly id: "claude" | "codex";
  /**
   * Run one turn. Must not throw for ordinary failures — return a result with
   * `error` set instead, so one participant erroring never kills the forum.
   */
  speak(prompt: string, ctx: DriverContext): Promise<ForumTurnResult>;
}

/** Hard ceiling on a single participant turn, whatever the driver. */
export const TURN_WALL_CLOCK_MS = 5 * 60 * 1000;
