"use client";

import { useState } from "react";

type Kind = "wandb_pull" | "github_pull" | "stall_detect";

export function RunJobButton({ kind, label }: { kind: Kind; label: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function run() {
    setBusy(true);
    setStatus("…");
    try {
      const resp = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      setStatus(resp.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(""), 1500);
    }
  }
  return (
    <button
      type="button"
      className="button buttonSecondary"
      onClick={run}
      disabled={busy}
    >
      {busy ? "Running…" : label}
      {status ? ` · ${status}` : null}
    </button>
  );
}
