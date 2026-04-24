"use client";

import { useEffect, useRef, useState } from "react";

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Lazy-fetch on first open.
  useEffect(() => {
    if (!open || html || loading) return;
    setLoading(true);
    fetch("/api/help")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHtml)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, html, loading]);

  // ESC closes; ? opens (when not typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (
        e.key === "?" &&
        !(e.target instanceof HTMLElement &&
          (e.target.tagName === "INPUT" ||
            e.target.tagName === "TEXTAREA" ||
            e.target.isContentEditable))
      ) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="helpButton"
        onClick={() => setOpen(true)}
        aria-label="How does this work?"
        title="How does this work? (?)"
      >
        ?
      </button>

      {open ? (
        <div className="helpBackdrop" onClick={() => setOpen(false)}>
          <aside
            ref={drawerRef}
            className="helpDrawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Help"
          >
            <div className="helpHeader">
              <div>
                <div className="brandName" style={{ fontSize: 16 }}>How does this work?</div>
                <div className="muted small">Live from the README.</div>
              </div>
              <button
                type="button"
                className="button buttonSecondary"
                onClick={() => setOpen(false)}
                style={{ padding: "4px 10px", fontSize: 12 }}
                aria-label="Close help"
              >
                Close · esc
              </button>
            </div>
            <div className="helpBody prose">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : error ? (
                <p className="muted">Couldn&apos;t load README: {error}</p>
              ) : html ? (
                <div dangerouslySetInnerHTML={{ __html: html }} />
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
