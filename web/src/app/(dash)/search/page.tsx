"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Result = {
  sessionId: string;
  title: string | null;
  machine: string;
  projectId: string | null;
  projectTitle: string | null;
  lastAt: string | null;
  turnCount: number;
  snippet: string;
};

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      setCount(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search/threads?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setResults(d.results ?? []);
        setCount(d.count ?? 0);
      }
    } catch {
      /* leave previous */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(q), 220);
    return () => clearTimeout(t);
  }, [q, run]);

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Conversations</h1>
        <p className="pageSub">
          Full-text search across every Claude Code session, on every machine.
        </p>
      </header>

      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your conversations… (e.g. perlmutter sync, colliderml tracking)"
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: "var(--radius-md, 12px)",
          border: "1px solid var(--border2, #ccc)",
          background: "color-mix(in oklab, var(--paper, #fff) 90%, transparent)",
          color: "var(--ink)",
          fontSize: 15,
        }}
      />
      {count !== null && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {loading ? "searching…" : `${count} result${count === 1 ? "" : "s"}`}
        </p>
      )}

      <div className="stack" style={{ marginTop: 12 }}>
        {results.map((r) => (
          <Link key={r.sessionId} href={`/threads/${r.sessionId}`} className="card cardLink">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <strong>{r.title || "(untitled session)"}</strong>
              <span className="muted small">
                {r.lastAt ? new Date(r.lastAt).toLocaleDateString() : ""}
              </span>
            </div>
            <div
              className="muted small"
              style={{ marginTop: 4 }}
              dangerouslySetInnerHTML={{ __html: renderSnippet(r.snippet) }}
            />
            <div className="rowWrap" style={{ marginTop: 8, gap: 6 }}>
              <span className="pill">{r.machine}</span>
              {r.projectTitle && <span className="pill">{r.projectTitle}</span>}
              <span className="pill">{r.turnCount} turns</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// The FTS snippet wraps matches in ⟦ ⟧. Escape HTML, then turn those into <mark>.
function renderSnippet(s: string): string {
  const esc = (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(/⟦/g, "<mark>").replace(/⟧/g, "</mark>");
}
