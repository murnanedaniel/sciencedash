"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Message = {
  kind: "assistant" | "user" | "system" | "result";
  at: string;
  subtype?: string;
  content?: unknown;
  costUsd?: number | null;
  error?: string;
};

type Job = {
  id: string;
  kind: string;
  title: string | null;
  projectId: string | null;
  startedAt: string;
  endedAt: string | null;
  ok: boolean | null;
  error: string | null;
  costUsd: number | null;
  messages: Message[];
};

export function TraceViewer({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [aborting, setAborting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let stopped = false;

    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
        } else {
          const data = (await r.json()) as Job;
          setJob(data);
          setError(null);
          if (data.endedAt) {
            stopped = true;
            return;
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [job?.messages.length, autoScroll]);

  async function cancel() {
    setAborting(true);
    try {
      await fetch(`/api/jobs/${jobId}/abort`, { method: "POST" });
    } finally {
      setAborting(false);
    }
  }

  if (!job && error) {
    return <div className="card muted">couldn&apos;t load job: {error}</div>;
  }
  if (!job) {
    return <div className="card muted">loading…</div>;
  }

  const running = job.endedAt == null;
  const statusPill = running
    ? "running"
    : job.ok
      ? "ok"
      : "failed";

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="stackTight" style={{ minWidth: 0, flex: 1 }}>
            <h2 className="sectionTitle" style={{ marginBottom: 4 }}>
              {job.title ?? job.kind}
            </h2>
            <div className="rowWrap">
              <span className="pill">{job.kind}</span>
              <span
                className="pill"
                style={{
                  color:
                    statusPill === "ok"
                      ? "var(--accent)"
                      : statusPill === "failed"
                        ? "var(--danger)"
                        : "var(--accent2)",
                }}
              >
                {statusPill}
              </span>
              {typeof job.costUsd === "number" ? (
                <span className="pill muted">
                  ${job.costUsd.toFixed(3)}
                </span>
              ) : null}
              {job.projectId ? (
                <Link className="link small" href={`/projects/${job.projectId}`}>
                  ← project
                </Link>
              ) : null}
            </div>
            {job.error ? (
              <div className="muted small" style={{ marginTop: 6, color: "var(--danger)" }}>
                {job.error}
              </div>
            ) : null}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <label className="muted small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                style={{ width: "auto" }}
              />
              auto-scroll
            </label>
            {running ? (
              <button
                type="button"
                className="button buttonDanger"
                onClick={cancel}
                disabled={aborting}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                {aborting ? "…" : "Cancel"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card" style={{ maxHeight: "68vh", overflow: "auto" }}>
        {job.messages.length === 0 ? (
          <p className="muted small">no messages yet</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {job.messages.map((m, i) => (
              <MessageRow key={i} m={m} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function MessageRow({ m }: { m: Message }) {
  const ts = new Date(m.at).toLocaleTimeString("en-GB", { hour12: false });
  return (
    <div className="activityRow" style={{ alignItems: "flex-start" }}>
      <time>{ts}</time>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="rowWrap" style={{ marginBottom: 4 }}>
          <strong style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.08em" }}>
            {m.kind}
            {m.subtype ? ` · ${m.subtype}` : ""}
          </strong>
        </div>
        <MessageBody m={m} />
      </div>
    </div>
  );
}

function MessageBody({ m }: { m: Message }) {
  if (m.kind === "result") {
    return (
      <div className="muted small" style={{ whiteSpace: "pre-wrap" }}>
        {m.error ? `error: ${m.error}` : "success"}
      </div>
    );
  }
  if (m.kind === "system") {
    if (m.subtype === "orchestrator") {
      const msg = (m.content as { message?: string } | null)?.message ?? "";
      return <div className="small" style={{ whiteSpace: "pre-wrap" }}>{msg}</div>;
    }
    return (
      <pre
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
        }}
      >
        {JSON.stringify(m.content, null, 2).slice(0, 400)}
      </pre>
    );
  }

  // assistant or user: content is an array of blocks ({type: "text", text} / {type: "tool_use", name, input} / {type: "tool_result", content, is_error})
  const blocks = Array.isArray(m.content) ? (m.content as Array<{type?: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean}>) : [];
  return (
    <div className="stackTight" style={{ gap: 6 }}>
      {blocks.map((b, i) => {
        if (b.type === "text") {
          return (
            <div key={i} style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
              {b.text ?? ""}
            </div>
          );
        }
        if (b.type === "tool_use") {
          return (
            <div
              key={i}
              style={{
                fontFamily: "var(--font-geist-mono)",
                fontSize: 11,
                color: "var(--muted)",
                borderLeft: "2px solid var(--border2)",
                padding: "2px 8px",
              }}
            >
              <strong style={{ color: "var(--ink)" }}>{b.name}</strong>(
              {JSON.stringify(b.input).slice(0, 300)})
            </div>
          );
        }
        if (b.type === "tool_result") {
          const txt = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          return (
            <div
              key={i}
              style={{
                fontFamily: "var(--font-geist-mono)",
                fontSize: 11,
                color: b.is_error ? "var(--danger)" : "var(--muted)",
                borderLeft: "2px solid var(--border)",
                padding: "2px 8px",
                whiteSpace: "pre-wrap",
              }}
            >
              {b.is_error ? "✗ " : "✓ "}
              {txt.slice(0, 400)}
              {txt.length > 400 ? " …" : ""}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
