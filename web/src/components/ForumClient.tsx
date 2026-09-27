"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

/* Mirrors src/lib/forum/types.ts + sessions.ts over the wire. */
type ForumTurnEvent =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool_use"; name: string; input?: unknown }
  | { kind: "tool_result"; name?: string; content?: unknown; isError: boolean }
  | { kind: "error"; message: string };

type Message = {
  id: string;
  idx: number;
  author: string;
  role: "human" | "agent" | "system";
  text: string;
  /** Server-rendered, sanitised markdown; null for system messages. */
  html: string | null;
  events: ForumTurnEvent[];
  costUsd: number | null;
  addressed: string | null;
  createdAt: string;
};

type Participant = {
  handle: string;
  driver: string;
  model: string;
  persona: string;
  seat: number;
  active: boolean;
};

type ForumState = {
  id: string;
  title: string;
  topic: string;
  status: string;
  turnsSpent: number;
  turnBudget: number;
  costUsd: number;
  projectId: string | null;
  note: string | null;
  workdir: string | null;
  attachmentsDir: string;
};

type UploadProgress = {
  name: string;
  current: number;
  total: number;
};

type Props = { forumId: string };

const SEAT_HUES = [215, 150, 32, 320];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/** Inline `--tag-hue` for a participant, reusing the project tags' dot style. */
function participantStyle(seat: number): CSSProperties {
  const hue = SEAT_HUES[Math.abs(seat) % SEAT_HUES.length];
  return {
    ["--tag-hue" as string]: String(hue),
  } as CSSProperties;
}

/**
 * Live forum view: transcript + a composer + the control strip.
 *
 * Reads one SSE stream (`snapshot` then live events) and writes back through
 * plain POSTs. The stream is authoritative — an interjection isn't rendered
 * optimistically, it appears when the server commits it, so what you see is
 * always what the participants will see.
 */
export function ForumClient({ forumId }: Props) {
  const [forum, setForum] = useState<ForumState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<ForumTurnEvent[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [uploading, setUploading] = useState<UploadProgress | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pinnedRef = useRef(true);

  // Follow the bottom only when the reader is already there — a forum keeps
  // producing turns, and yanking the viewport while someone is reading back
  // is the fastest way to make a live transcript unusable.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, liveEvents, speaking]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const es = new EventSource(`/api/forum/${forumId}/stream`);

    es.addEventListener("open", () => setConnected(true));

    es.addEventListener("snapshot", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setForum(d.forum);
      setParticipants(d.participants ?? []);
      setMessages(d.messages ?? []);
      setSpeaking(d.speaking ?? null);
      setNote(d.forum.note ?? null);
      setConnected(true);
    });

    es.addEventListener("turn_start", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setSpeaking(d.handle);
      setLiveEvents([]);
    });

    es.addEventListener("turn_event", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setLiveEvents((prev) => [...prev, d.event]);
    });

    es.addEventListener("message", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setSpeaking(null);
      setLiveEvents([]);
      // Dedupe by id: a reconnect re-snapshots, and the loop may emit a
      // message this client already has.
      setMessages((prev) =>
        prev.some((m) => m.id === d.message.id) ? prev : [...prev, d.message],
      );
    });

    es.addEventListener("status", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setForum((f) =>
        f
          ? {
              ...f,
              status: d.status,
              turnsSpent: d.turnsSpent,
              turnBudget: d.turnBudget,
              costUsd: d.costUsd,
            }
          : f,
      );
      setNote(d.note ?? null);
      if (d.status !== "running") setSpeaking(null);
    });

    // Only transport failures arrive here — EventSource retries on its own.
    // Forum-level failures are committed to the transcript as system
    // messages instead, so they are never shown twice.
    es.addEventListener("error", () => {
      setConnected(false);
    });

    return () => es.close();
  }, [forumId]);

  const post = useCallback(
    async (path: string, body: unknown) => {
      try {
        const res = await fetch(`/api/forum/${forumId}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const t = await res.text();
          setErrors((prev) => [...prev.slice(-4), `${res.status}: ${t.slice(0, 200)}`]);
        }
      } catch (err) {
        setErrors((prev) => [
          ...prev.slice(-4),
          err instanceof Error ? err.message : String(err),
        ]);
      }
    },
    [forumId],
  );

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void post("message", { text });
  };

  const uploadAttachments = async (files: File[]) => {
    if (files.length === 0) return;

    try {
      // Keep requests sequential so transcript announcements preserve selection
      // order and the server never buffers several 10 MB request bodies at once.
      for (const [index, file] of files.entries()) {
        setUploading({ name: file.name, current: index + 1, total: files.length });

        if (file.size > MAX_ATTACHMENT_SIZE) {
          setErrors((prev) => [
            ...prev.slice(-4),
            `${file.name} is over 10 MB — skipped`,
          ]);
          continue;
        }

        const body = new FormData();
        body.append("file", file);

        try {
          const res = await fetch(`/api/forum/${forumId}/attachments`, {
            method: "POST",
            body,
          });
          if (!res.ok) {
            let message = `Upload failed (${res.status})`;
            try {
              const data = (await res.json()) as { error?: string };
              if (data.error) message = data.error;
            } catch {
              // Keep the status-based fallback for a malformed error response.
            }
            setErrors((prev) => [...prev.slice(-4), message]);
          }
        } catch (err) {
          setErrors((prev) => [
            ...prev.slice(-4),
            err instanceof Error ? err.message : String(err),
          ]);
        }
      }
    } finally {
      setUploading(null);
    }
  };

  const handles = useMemo(() => participants.map((p) => p.handle), [participants]);
  const participantsByHandle = useMemo(
    () => new Map(participants.map((participant) => [participant.handle, participant])),
    [participants],
  );
  const ended = forum?.status === "ended";
  const running = forum?.status === "running";

  // Until the first snapshot lands there is nothing true to show: an empty
  // transcript would claim "nothing said yet" and the controls would act on
  // state we haven't seen.
  if (!forum) {
    return (
      <div className="stack" style={{ minHeight: "82vh" }}>
        <p className="muted" style={{ padding: "32px 0" }}>
          Connecting to forum…
        </p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ minHeight: "82vh" }}>
      <header className="pageHead">
        <h1 className="pageTitle">{forum?.title ?? "Forum"}</h1>
        <p className="pageSub">
          {participants.map((p, i) => (
            <span
              key={p.handle}
              style={{
                ...participantStyle(p.seat),
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                marginLeft: i > 0 ? 6 : 0,
              }}
            >
              {i > 0 ? <span aria-hidden="true">·</span> : null}
              <span className="tagDot" />
              <strong>@{p.handle}</strong>{" "}
              <span className="muted small">{p.model}</span>
            </span>
          ))}
          {participants.length ? " · " : ""}
          <strong>@human</strong> <span className="muted small">you</span>
        </p>
        {forum?.workdir ? (
          <p className="muted small" style={{ marginTop: 4 }}>
            repo: {forum.workdir}
          </p>
        ) : null}
      </header>

      <StatusStrip
        forum={forum}
        speaking={speaking}
        speakingParticipant={
          speaking ? participantsByHandle.get(speaking) ?? null : null
        }
        connected={connected}
        note={note}
        onControl={(action) => post("control", { action })}
      />

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="card"
        style={{
          flex: 1,
          minHeight: 320,
          maxHeight: "58vh",
          overflowY: "auto",
          padding: 14,
        }}
      >
        {forum?.topic ? (
          <div
            style={{
              marginBottom: 14,
              paddingBottom: 12,
              borderBottom: "1px dashed var(--border)",
            }}
          >
            <div className="muted small">topic</div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{forum.topic}</div>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <p className="muted" style={{ textAlign: "center", padding: 32 }}>
            Nothing said yet. Interject, attach a file, or address someone
            directly with <code>@{handles[0] ?? "claude"}</code>.
          </p>
        ) : null}

        {messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            participant={participantsByHandle.get(m.author) ?? null}
          />
        ))}

        {speaking ? (
          <LiveTurn
            handle={speaking}
            participant={participantsByHandle.get(speaking) ?? null}
            events={liveEvents}
          />
        ) : null}
      </div>

      {errors.length ? (
        <div
          className="card"
          style={{
            padding: 8,
            background: "rgba(192,50,42,0.06)",
            border: "1px solid rgba(192,50,42,0.25)",
          }}
        >
          {errors.map((error, i) => (
            <div key={i} className="small" style={{ color: "var(--red, #c0322a)" }}>
              {error}
            </div>
          ))}
          <button
            type="button"
            className="link small"
            onClick={() => setErrors([])}
            style={{ border: "none", background: "transparent", padding: 0, marginTop: 4 }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <form
        className="card"
        style={{ padding: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          autoFocus
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          disabled={ended}
          placeholder={
            ended
              ? "This forum has ended."
              : `Interject — @${handles[0] ?? "claude"} to address someone directly (Cmd/Ctrl+Enter)`
          }
          style={{
            width: "100%",
            minHeight: 64,
            fontFamily: "inherit",
            fontSize: 14,
            border: "none",
            outline: "none",
            background: "transparent",
            resize: "vertical",
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          disabled={ended || uploading !== null}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void uploadAttachments(files);
          }}
        />
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 6,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="link small"
              disabled={ended || uploading !== null}
              onClick={() => fileInputRef.current?.click()}
              style={{ border: "none", background: "transparent", padding: 0 }}
            >
              Attach
            </button>
            <span className="muted small">
              {uploading
                ? uploading.total === 1
                  ? `Uploading ${uploading.name}…`
                  : `Uploading ${uploading.current} of ${uploading.total}: ${uploading.name}…`
                : running && speaking
                  ? `sending will interrupt @${speaking}`
                  : "your message resets the turn budget"}
            </span>
          </div>
          <button type="submit" className="button" disabled={!input.trim() || ended}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function StatusStrip({
  forum,
  speaking,
  speakingParticipant,
  connected,
  note,
  onControl,
}: {
  forum: ForumState | null;
  speaking: string | null;
  speakingParticipant: Participant | null;
  connected: boolean;
  note: string | null;
  onControl: (action: string) => void;
}) {
  const ended = forum?.status === "ended";
  const running = forum?.status === "running";

  return (
    <div
      className="card row"
      style={{
        padding: "8px 12px",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <div
        className="row small"
        style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}
      >
        <span className={connected ? "pill" : "pill pillMuted"}>
          {forum?.status ?? "…"}
        </span>
        {!connected ? <span className="muted">reconnecting…</span> : null}
        <span className="muted">
          turns {forum?.turnsSpent ?? 0}/{forum?.turnBudget ?? 0}
        </span>
        {forum && forum.costUsd > 0 ? (
          <span className="muted" title="Claude turns only — codex reports tokens, not dollars">
            ${forum.costUsd.toFixed(4)}
          </span>
        ) : null}
        {speaking ? (
          <span
            style={{
              ...(speakingParticipant
                ? participantStyle(speakingParticipant.seat)
                : {}),
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {speakingParticipant ? <span className="tagDot" /> : null}
            @{speaking} is speaking…
          </span>
        ) : null}
        {note ? <span className="muted">· {note}</span> : null}
      </div>

      <div
        className="row"
        style={{
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginLeft: "auto",
        }}
      >
        <button
          type="button"
          className="button buttonSecondary"
          disabled={ended}
          onClick={() => onControl(running ? "pause" : "resume")}
        >
          {running ? "Pause" : "Resume"}
        </button>
        {speaking ? (
          <button
            type="button"
            className="button buttonSecondary"
            onClick={() => onControl("abort")}
            title="Stop the turn in flight"
          >
            Stop turn
          </button>
        ) : null}
        <div className="row" style={{ gap: 10, marginLeft: "auto" }}>
          <button
            type="button"
            className="link small"
            disabled={ended}
            onClick={() => onControl("resync")}
            title="Drop each participant's private session; they re-read the full transcript next turn"
            style={{ border: "none", background: "transparent", padding: 0 }}
          >
            Resync
          </button>
          <button
            type="button"
            className="link small"
            disabled={ended}
            onClick={() => {
              if (window.confirm("End this forum? It can't be resumed.")) {
                onControl("end");
              }
            }}
            style={{ border: "none", background: "transparent", padding: 0 }}
          >
            End
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageView({
  message,
  participant,
}: {
  message: Message;
  participant: Participant | null;
}) {
  const isHuman = message.role === "human";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div
        className="muted small"
        style={{ margin: "10px 0", fontStyle: "italic", textAlign: "center" }}
      >
        {message.text}
      </div>
    );
  }

  const style = participant ? participantStyle(participant.seat) : {};

  return (
    <div
      style={{
        ...style,
        margin: "14px 0",
        paddingLeft: 10,
        borderLeft: `2px solid ${
          isHuman
            ? "var(--ink)"
            : participant
              ? "hsl(var(--tag-hue) 45% 60% / 0.45)"
              : "var(--border)"
        }`,
      }}
    >
      <div className="row small" style={{ gap: 8, alignItems: "center" }}>
        {!isHuman && participant ? <span className="tagDot" /> : null}
        <strong>@{message.author}</strong>
        {message.costUsd !== null ? (
          <span className="muted">${message.costUsd.toFixed(4)}</span>
        ) : null}
        {message.addressed ? (
          <span className="muted">→ @{message.addressed}</span>
        ) : null}
      </div>
      <EventList events={message.events} />
      {message.html !== null ? (
        // Sanitised server-side by renderUntrustedMarkdown: raw HTML is
        // escaped and only http(s)/mailto links survive.
        <div
          className="mdBody"
          style={{ fontSize: 14, marginTop: 4 }}
          dangerouslySetInnerHTML={{ __html: message.html }}
        />
      ) : (
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, marginTop: 4 }}>
          {message.text}
        </div>
      )}
    </div>
  );
}

function LiveTurn({
  handle,
  participant,
  events,
}: {
  handle: string;
  participant: Participant | null;
  events: ForumTurnEvent[];
}) {
  const style = participant ? participantStyle(participant.seat) : {};

  return (
    <div
      style={{
        ...style,
        margin: "14px 0",
        paddingLeft: 10,
        borderLeft: participant
          ? "2px dashed hsl(var(--tag-hue) 45% 60% / 0.45)"
          : "2px dashed var(--border)",
      }}
    >
      <div className="row small" style={{ gap: 8, alignItems: "center" }}>
        {participant ? <span className="tagDot" /> : null}
        <strong>@{handle}</strong>
        <span className="muted">thinking…</span>
      </div>
      <EventList events={events} showText />
    </div>
  );
}

function EventList({
  events,
  showText = false,
}: {
  events: ForumTurnEvent[];
  showText?: boolean;
}) {
  const shown = showText ? events : events.filter((event) => event.kind !== "text");
  if (shown.length === 0) return null;

  return (
    <div style={{ margin: "4px 0" }}>
      {shown.map((event, i) =>
        event.kind === "text" ? (
          <div
            key={i}
            style={{ whiteSpace: "pre-wrap", fontSize: 14, marginTop: 4 }}
          >
            {event.text}
          </div>
        ) : (
          <EventRow key={i} event={event} />
        ),
      )}
    </div>
  );
}

function EventRow({ event }: { event: ForumTurnEvent }) {
  const box = (
    label: string,
    body: string,
    tone: "normal" | "error" = "normal",
  ) => (
    <details
      style={{
        margin: "3px 0",
        padding: "3px 8px",
        background:
          tone === "error"
            ? "rgba(192,50,42,0.08)"
            : "var(--surface-2, rgba(0,0,0,0.04))",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <summary style={{ cursor: "pointer" }} className="muted small">
        {label}
      </summary>
      <pre style={{ marginTop: 6, fontSize: 11, overflow: "auto", maxHeight: 280 }}>
        {body}
      </pre>
    </details>
  );

  switch (event.kind) {
    case "reasoning":
      return box("reasoning", event.text);
    case "tool_use":
      return box(`tool: ${event.name}`, safeJson(event.input));
    case "tool_result":
      return box(
        event.isError ? "tool error" : "tool result",
        renderContent(event.content),
        event.isError ? "error" : "normal",
      );
    case "error":
      return box("error", event.message, "error");
    default:
      return null;
  }
}

function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === "object") {
          const value = block as { type?: string; text?: string };
          if (value.type === "text" && typeof value.text === "string") {
            return value.text;
          }
        }
        return safeJson(block);
      })
      .join("\n");
  }
  return safeJson(content);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
