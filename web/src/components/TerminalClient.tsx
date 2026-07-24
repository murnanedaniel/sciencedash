"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * Web terminal client — a real xterm.js frontend wired to a server-side PTY.
 *
 * Transport (no WebSocket; `next start` doesn't expose the HTTP upgrade
 * through route handlers):
 *   - POST /api/terminal/session          → spawn a shell, get an id
 *   - GET  /api/terminal/{id}/stream (SSE) → shell output (snapshot + live)
 *   - POST /api/terminal/{id}/input        → keystrokes
 *   - POST /api/terminal/{id}/resize       → grid size
 *   - DELETE /api/terminal/{id}            → kill on close
 *
 * Keystrokes are queued and flushed sequentially so bursty typing can't
 * arrive out of order (independent fetches don't preserve order).
 */

type Status = "connecting" | "live" | "exited" | "error";

export function TerminalClient() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Sequential input queue: append here, a single flusher drains it in order.
  const inputQueueRef = useRef<string>("");
  const flushingRef = useRef<boolean>(false);

  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to re-init a fresh session

  const flushInput = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (inputQueueRef.current.length > 0) {
        const id = sessionIdRef.current;
        if (!id) break;
        const data = inputQueueRef.current;
        inputQueueRef.current = "";
        try {
          await fetch(`/api/terminal/${id}/input`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data }),
          });
        } catch {
          // Network hiccup — re-queue what we tried to send and stop; the
          // next keystroke (or a retry) will pick it back up.
          inputQueueRef.current = data + inputQueueRef.current;
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  const sendResize = useCallback(async (cols: number, rows: number) => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/terminal/${id}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols, rows }),
      });
    } catch {
      // resize is best-effort
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: "#07080b",
        foreground: "#e8eaf6",
        cursor: "#a7ffea",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      // container not measured yet — the ResizeObserver below will fit
    }
    termRef.current = term;
    fitRef.current = fit;

    // Keystrokes → queue → sequential POST.
    const onDataDisp = term.onData((data) => {
      inputQueueRef.current += data;
      void flushInput();
    });

    async function start() {
      setStatus("connecting");
      setErrorMsg(null);
      try {
        const res = await fetch("/api/terminal/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cols: term.cols, rows: term.rows }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `session create failed (${res.status})`);
        }
        const { id } = (await res.json()) as { id: string };
        if (disposed) {
          // Component unmounted during the request — clean up the shell.
          void fetch(`/api/terminal/${id}`, { method: "DELETE" });
          return;
        }
        sessionIdRef.current = id;

        const es = new EventSource(`/api/terminal/${id}/stream`);
        esRef.current = es;

        es.addEventListener("snapshot", (ev) => {
          // Full scrollback replay (initial connect or auto-reconnect):
          // reset first so a reconnect doesn't stack a duplicate copy.
          const chunk = JSON.parse((ev as MessageEvent).data) as string;
          term.reset();
          if (chunk) term.write(chunk);
          setStatus("live");
        });
        es.addEventListener("data", (ev) => {
          const chunk = JSON.parse((ev as MessageEvent).data) as string;
          term.write(chunk);
        });
        es.addEventListener("exit", (ev) => {
          const info = JSON.parse((ev as MessageEvent).data) as {
            exitCode: number;
            signal?: number;
          };
          term.write(
            `\r\n\x1b[90m[process exited: code ${info.exitCode}${
              info.signal ? `, signal ${info.signal}` : ""
            }]\x1b[0m\r\n`,
          );
          setStatus("exited");
          es.close();
        });
        es.onerror = () => {
          // EventSource retries on its own; only surface an error if the
          // session is actually gone (we'll find out on the next snapshot).
          if (es.readyState === EventSource.CLOSED) {
            setStatus("error");
            setErrorMsg("stream closed");
          }
        };

        // Sync the real grid size to the PTY now that it exists.
        void sendResize(term.cols, term.rows);
      } catch (e) {
        if (disposed) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    }

    void start();

    // Refit on container/window resize, then tell the PTY the new size.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void sendResize(term.cols, term.rows);
      } catch {
        // ignore transient measure failures
      }
    });
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      onDataDisp.dispose();
      esRef.current?.close();
      const id = sessionIdRef.current;
      if (id) {
        // Best-effort kill so we don't leak shells when leaving the page.
        void fetch(`/api/terminal/${id}`, { method: "DELETE", keepalive: true });
      }
      sessionIdRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // `nonce` re-runs the whole effect for a fresh session on "restart".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushInput, sendResize, nonce]);

  const restart = useCallback(() => {
    const id = sessionIdRef.current;
    if (id) void fetch(`/api/terminal/${id}`, { method: "DELETE" });
    setNonce((n) => n + 1);
  }, []);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span
            className="pill"
            style={{
              color:
                status === "live"
                  ? "var(--accent)"
                  : status === "error"
                    ? "var(--danger)"
                    : "var(--faint)",
              whiteSpace: "nowrap",
            }}
            title={errorMsg ?? undefined}
          >
            {status === "connecting"
              ? "connecting…"
              : status === "live"
                ? "live"
                : status === "exited"
                  ? "exited"
                  : "error"}
          </span>
          {errorMsg && (
            <span className="muted small" style={{ maxWidth: 480 }}>
              {errorMsg}
            </span>
          )}
        </div>
        <button
          type="button"
          className="button buttonSecondary"
          onClick={restart}
          style={{ whiteSpace: "nowrap" }}
        >
          {status === "exited" || status === "error"
            ? "New session"
            : "Restart"}
        </button>
      </div>
      <div
        ref={containerRef}
        style={{
          height: "70vh",
          minHeight: 360,
          background: "#07080b",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 8,
          overflow: "hidden",
        }}
      />
    </div>
  );
}
