"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RunAiAuditButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [, start] = useTransition();
  const router = useRouter();
  async function run() {
    setBusy(true);
    setMsg("thinking…");
    try {
      const resp = await fetch("/api/ai/audit", { method: "POST" });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        setMsg(j.error ?? "error");
        return;
      }
      setMsg("done");
      start(() => router.refresh());
    } catch {
      setMsg("error");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 2400);
    }
  }
  return (
    <button type="button" className="button" onClick={run} disabled={busy}>
      {busy ? "…" : "Run portfolio audit"}
      {msg ? ` · ${msg}` : null}
    </button>
  );
}
