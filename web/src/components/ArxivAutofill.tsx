"use client";

import { useState } from "react";

export function ArxivAutofill() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"" | "fetching" | "ok" | "error">("");

  async function autofill() {
    setStatus("fetching");
    try {
      const resp = await fetch("/api/ingest/arxiv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!resp.ok) {
        setStatus("error");
        return;
      }
      const meta = (await resp.json()) as {
        title: string;
        authors: string;
        abstract: string;
      };
      const t = document.querySelector<HTMLInputElement>('input[name="title"]');
      const a = document.querySelector<HTMLInputElement>('input[name="authors"]');
      const s = document.querySelector<HTMLTextAreaElement>('textarea[name="summaryMd"]');
      if (t) t.value = meta.title;
      if (a) a.value = meta.authors;
      if (s && !s.value) s.value = meta.abstract;
      setStatus("ok");
    } catch {
      setStatus("error");
    } finally {
      setTimeout(() => setStatus(""), 1800);
    }
  }

  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        name="url"
        placeholder="https://arxiv.org/abs/2501.12345"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ flex: 1 }}
      />
      <button
        type="button"
        className="button buttonSecondary"
        disabled={!url || status === "fetching"}
        onClick={autofill}
      >
        {status === "fetching" ? "…" : status === "ok" ? "filled" : status === "error" ? "error" : "autofill"}
      </button>
    </div>
  );
}
