"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RunAiReviewButton({
  projectId,
  label = "Run AI critical review",
}: {
  projectId: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [, start] = useTransition();
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg("thinking…");
    try {
      const resp = await fetch("/api/ai/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
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
    <button
      type="button"
      className="button"
      onClick={run}
      disabled={busy}
      style={{ width: "fit-content" }}
    >
      {busy ? "…" : label}
      {msg ? ` · ${msg}` : null}
    </button>
  );
}
