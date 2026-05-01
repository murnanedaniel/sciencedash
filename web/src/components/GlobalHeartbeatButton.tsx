"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function GlobalHeartbeatButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();

  async function run(force: boolean) {
    setBusy(true);
    setMsg("running brains across active projects…");
    try {
      const resp = await fetch("/api/brain/global", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await resp.json();
      const cost =
        typeof data.totalCostUsd === "number" ? `$${data.totalCostUsd.toFixed(2)}` : "?";
      setMsg(
        `done · ran ${data.ran} · skipped ${data.skipped} · failed ${data.failed} · ${cost}`,
      );
      start(() => router.refresh());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 6, alignItems: "center" }}>
      <button
        type="button"
        className="button buttonSecondary small"
        disabled={busy}
        onClick={() => run(false)}
        title="Run brain heartbeats on all active projects (5 min anti-burn floor per project)"
      >
        {busy ? "…" : "Run brains"}
      </button>
      <button
        type="button"
        className="button buttonSecondary small"
        disabled={busy}
        onClick={() => run(true)}
        title="Force heartbeat on all active projects regardless of recency"
      >
        Force
      </button>
      {msg ? <span className="muted small">{msg}</span> : null}
    </span>
  );
}
