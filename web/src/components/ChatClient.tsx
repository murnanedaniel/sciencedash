"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ToolUseBlock = {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: unknown;
};
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};
type TextBlock = { type: "text"; text?: string };
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string };

type Turn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; content: ContentBlock[] }
  | { kind: "tool_result"; content: ToolResultBlock[] }
  | { kind: "error"; text: string }
  | { kind: "result"; subtype: string | null; costUsd: number | null; text: string | null };

type Props = {
  initialMessage: string;
};

/**
 * /chat client — single textarea + scrolling turn history.
 *
 * Submit → POST to /api/chat/stream, read the SSE response, append
 * turns as they arrive. The server's `session` event hands back a
 * sessionId; we send it on the next submit so the SDK can resume the
 * same subprocess-side conversation.
 *
 * No persistence — refreshing the page drops the thread. That's fine
 * for an MVP; the chat can call `submit_brain_chat` itself when the
 * user signals end-of-session.
 */
export function ChatClient({ initialMessage }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const initialFiredRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom whenever turns or in-flight content changes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const send = useCallback(
    async (message: string) => {
      if (!message.trim() || sending) return;
      setSending(true);
      setTurns((t) => [...t, { kind: "user", text: message }]);
      setInput("");

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            sessionId: sessionId ?? undefined,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const txt = await res.text();
          setTurns((t) => [
            ...t,
            { kind: "error", text: `HTTP ${res.status}: ${txt.slice(0, 400)}` },
          ]);
          return;
        }
        if (!res.body) {
          setTurns((t) => [
            ...t,
            { kind: "error", text: "response body is null" },
          ]);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // SSE frames are separated by blank lines.
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleFrame(frame, {
              setTurns,
              setSessionId,
            });
          }
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setTurns((t) => [
          ...t,
          {
            kind: "error",
            text: e instanceof Error ? e.message : String(e),
          },
        ]);
      } finally {
        abortRef.current = null;
        setSending(false);
      }
    },
    [sending, sessionId],
  );

  // Fire the initialMessage exactly once when the page mounts with a
  // ?q= param (e.g. when the homepage redirected here with a typed
  // message).
  useEffect(() => {
    if (initialFiredRef.current) return;
    if (initialMessage && initialMessage.trim()) {
      initialFiredRef.current = true;
      void send(initialMessage);
    }
  }, [initialMessage, send]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const cancel = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  return (
    <div className="stack" style={{ minHeight: "82vh" }}>
      <header className="pageHead">
        <h1 className="pageTitle">Chat</h1>
        <p className="pageSub">
          Dump an idea. The chat has the full MCP surface — it can spawn
          workhorses, create projects, post messages, all without you copy-
          pasting anything.{" "}
          <a href="/settings" className="link small">
            Kill switch
          </a>
          .
        </p>
      </header>

      <div
        ref={scrollerRef}
        className="card"
        style={{
          flex: 1,
          minHeight: 320,
          maxHeight: "62vh",
          overflowY: "auto",
          padding: 14,
        }}
      >
        {turns.length === 0 && !sending ? (
          <p className="muted" style={{ textAlign: "center", padding: 32 }}>
            No turns yet. Try: <em>&quot;what should I work on today?&quot;</em> ·
            <em> &quot;spin up a workhorse on perlmutter for the tracking ablation&quot;</em>
          </p>
        ) : null}
        {turns.map((t, i) => (
          <TurnView key={i} turn={t} />
        ))}
        {sending ? (
          <div className="muted small" style={{ padding: "8px 0" }}>
            <span className="spinner" /> thinking…
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="card" style={{ padding: 10 }}>
        <textarea
          autoFocus
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter submits — plain Enter keeps you on the same line.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="What's on your mind? (Cmd/Ctrl+Enter to send)"
          disabled={sending}
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
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center", marginTop: 6 }}
        >
          <div className="muted small">
            {sessionId ? (
              <span title={sessionId}>session: {sessionId.slice(0, 8)}…</span>
            ) : (
              "new session"
            )}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {sending ? (
              <button
                type="button"
                className="button buttonSecondary"
                onClick={cancel}
              >
                Cancel
              </button>
            ) : (
              <button
                type="submit"
                className="button"
                disabled={!input.trim()}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.kind === "user") {
    return (
      <div style={{ margin: "10px 0" }}>
        <div className="muted small">you</div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{turn.text}</div>
      </div>
    );
  }
  if (turn.kind === "assistant") {
    return (
      <div style={{ margin: "10px 0" }}>
        <div className="muted small">claude</div>
        {turn.content.map((b, i) => (
          <AssistantBlock key={i} block={b} />
        ))}
      </div>
    );
  }
  if (turn.kind === "tool_result") {
    return (
      <div style={{ margin: "8px 0" }}>
        {turn.content.map((r, i) => (
          <ToolResultBlockView key={i} block={r} />
        ))}
      </div>
    );
  }
  if (turn.kind === "error") {
    return (
      <div
        style={{
          margin: "10px 0",
          padding: 8,
          background: "rgba(192,50,42,0.08)",
          border: "1px solid rgba(192,50,42,0.25)",
          borderRadius: 4,
        }}
      >
        <div className="small" style={{ color: "var(--red, #c0322a)" }}>
          error: {turn.text}
        </div>
      </div>
    );
  }
  // result
  return (
    <div className="muted small" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>
      done
      {turn.costUsd !== null ? ` · $${turn.costUsd.toFixed(4)}` : ""}
      {turn.subtype && turn.subtype !== "success" ? ` · ${turn.subtype}` : ""}
    </div>
  );
}

function AssistantBlock({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    const text = (block as TextBlock).text ?? "";
    return (
      <div style={{ whiteSpace: "pre-wrap", fontSize: 14, marginTop: 4 }}>
        {text}
      </div>
    );
  }
  if (block.type === "tool_use") {
    const tb = block as ToolUseBlock;
    const inputJson = useMemo(() => safeJson(tb.input), [tb.input]);
    return (
      <details
        style={{
          margin: "6px 0",
          padding: "4px 8px",
          background: "var(--surface-2, rgba(0,0,0,0.04))",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        <summary style={{ cursor: "pointer" }}>
          <span className="muted small">tool:</span>{" "}
          <code style={{ fontSize: 12 }}>{tb.name ?? "?"}</code>
        </summary>
        <pre style={{ marginTop: 6, fontSize: 11, overflow: "auto" }}>
          {inputJson}
        </pre>
      </details>
    );
  }
  return null;
}

function ToolResultBlockView({ block }: { block: ToolResultBlock }) {
  const rendered = useMemo(() => renderToolResult(block.content), [block.content]);
  const isError = block.is_error === true;
  return (
    <details
      style={{
        padding: "4px 8px",
        background: isError
          ? "rgba(192,50,42,0.08)"
          : "var(--surface-2, rgba(0,0,0,0.04))",
        borderRadius: 4,
        fontSize: 12,
        marginTop: 4,
      }}
    >
      <summary style={{ cursor: "pointer" }}>
        <span className="muted small">
          {isError ? "tool error" : "tool result"}
        </span>
      </summary>
      <pre style={{ marginTop: 6, fontSize: 11, overflow: "auto" }}>
        {rendered}
      </pre>
    </details>
  );
}

function renderToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b && typeof b === "object") {
          const o = b as { type?: string; text?: string };
          if (o.type === "text" && typeof o.text === "string") return o.text;
        }
        return safeJson(b);
      })
      .join("\n");
  }
  return safeJson(content);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

type FrameHandlers = {
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>;
};

function handleFrame(frame: string, h: FrameHandlers) {
  // SSE frames are key: value lines. We care about event + data.
  let eventName = "message";
  let dataLine = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return;
  }
  if (eventName === "session") {
    const sid = (payload as { sessionId?: string }).sessionId;
    if (typeof sid === "string") h.setSessionId(sid);
    return;
  }
  if (eventName === "assistant") {
    const content = (payload as { content?: unknown }).content;
    if (Array.isArray(content)) {
      h.setTurns((t) => [...t, { kind: "assistant", content: content as ContentBlock[] }]);
    }
    return;
  }
  if (eventName === "tool_result") {
    const content = (payload as { content?: unknown }).content;
    if (Array.isArray(content)) {
      h.setTurns((t) => [
        ...t,
        { kind: "tool_result", content: content as ToolResultBlock[] },
      ]);
    }
    return;
  }
  if (eventName === "error") {
    const msg = (payload as { message?: string }).message ?? "unknown error";
    h.setTurns((t) => [...t, { kind: "error", text: msg }]);
    return;
  }
  if (eventName === "result") {
    const p = payload as {
      subtype?: string | null;
      costUsd?: number | null;
      text?: string | null;
    };
    h.setTurns((t) => [
      ...t,
      {
        kind: "result",
        subtype: p.subtype ?? null,
        costUsd: p.costUsd ?? null,
        text: p.text ?? null,
      },
    ]);
    return;
  }
  // "done" — no-op (the reader's `done=true` already ends the loop).
}
