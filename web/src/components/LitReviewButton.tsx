"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function LitReviewButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [, start] = useTransition();
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg("asking Claude…");
    setLastJobId(null);
    try {
      const resp = await fetch("/api/ai/literature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          instructions: instructions.trim() || undefined,
        }),
      });
      const data = (await resp.json()) as
        | { ok: true; jobId?: string; created: number; updated: number; kept: number; dropped: number; rationale: string }
        | { error: string; jobId?: string };
      if (data.jobId) setLastJobId(data.jobId);
      if ("error" in data) {
        setMsg(`error: ${data.error.slice(0, 120)}`);
      } else {
        const parts = [
          `+${data.created} new`,
          data.updated > 0 ? `${data.updated} backfilled` : null,
          `dropped ${data.dropped}`,
        ].filter(Boolean);
        setMsg(parts.join(" · "));
        start(() => router.refresh());
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="column" style={{ gap: 8, alignItems: "stretch" }}>
      <textarea
        className="input"
        placeholder="Optional: focus the next review (e.g. 'prioritise pile-up realism and ATLAS-scale geometry')"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        disabled={busy}
        rows={2}
        style={{ resize: "vertical", minHeight: 40, fontSize: 13 }}
      />
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="button"
          onClick={run}
          disabled={busy}
          title="Let Claude propose a starter reading list for this project"
          style={{ width: "fit-content" }}
        >
          {busy ? "…" : "Literature review ✨"}
        </button>
        {msg ? <span className="muted small">{msg}</span> : null}
        {lastJobId ? (
          <Link className="link small" href={`/jobs/${lastJobId}`}>
            view trace →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
