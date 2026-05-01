"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function BrainHeartbeatButton({
  projectId,
  lastHeartbeatAt,
}: {
  projectId: string;
  lastHeartbeatAt: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();

  async function run(force: boolean) {
    setBusy(true);
    setMsg("brain thinking…");
    setLastJobId(null);
    try {
      const resp = await fetch("/api/brain/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, force }),
      });
      const data = await resp.json();
      if (data.jobId) setLastJobId(data.jobId);
      if (data.skipped) {
        setMsg(`skipped: ${data.reason}`);
      } else if (data.error) {
        setMsg(`error: ${String(data.error).slice(0, 120)}`);
      } else if (data.ok) {
        const cost = typeof data.costUsd === "number" ? `$${data.costUsd.toFixed(2)}` : "?";
        setMsg(
          `done · ${data.messagesPosted} message${data.messagesPosted === 1 ? "" : "s"} posted · memory ${data.memoryLogChars}c · ${cost}`,
        );
        start(() => router.refresh());
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const lastLabel = lastHeartbeatAt
    ? `last beat ${humanAgo(lastHeartbeatAt)}`
    : "never run";

  return (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => run(false)}
        title="Run a brain heartbeat — read project state, surface anything worth your attention, update memory log"
      >
        {busy ? "…" : "Brain heartbeat 🧠"}
      </button>
      <button
        type="button"
        className="button buttonSecondary small"
        disabled={busy}
        onClick={() => run(true)}
        title="Force a heartbeat even if the last one was within the 5-minute floor"
      >
        Force
      </button>
      <span className="muted small">{lastLabel}</span>
      {msg ? <span className="muted small">{msg}</span> : null}
      {lastJobId ? (
        <Link className="link small" href={`/jobs/${lastJobId}`}>
          view trace →
        </Link>
      ) : null}
    </div>
  );
}

function humanAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
