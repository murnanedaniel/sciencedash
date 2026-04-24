"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RunAiSkeletonButton({ paperId }: { paperId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [, start] = useTransition();
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg("thinking…");
    try {
      const resp = await fetch("/api/ai/skeleton", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId }),
      });
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
      setTimeout(() => setMsg(""), 2500);
    }
  }

  return (
    <button type="button" className="button" onClick={run} disabled={busy}>
      {busy ? "…" : "AI first pass"}
      {msg ? ` · ${msg}` : null}
    </button>
  );
}

export function RunAiPolishButton({ sectionId }: { sectionId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [, start] = useTransition();
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg("…");
    try {
      const resp = await fetch("/api/ai/polish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
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
      setTimeout(() => setMsg(""), 1600);
    }
  }

  return (
    <button
      type="button"
      className="button buttonSecondary"
      onClick={run}
      disabled={busy}
      style={{ padding: "4px 10px", fontSize: 12 }}
    >
      {busy ? "…" : "Polish"}
      {msg ? ` · ${msg}` : null}
    </button>
  );
}
