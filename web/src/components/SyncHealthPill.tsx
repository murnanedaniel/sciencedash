"use client";

/**
 * Sidebar sync.py health pill — one row per remote host.
 *
 * Shape mirrors the per-workhorse pill in WorkhorsesPanel: dot + label +
 * "on: loginXX · 23s ago". Color rolls up from the freshest heartbeat
 * across all workhorses on the host. Polls /api/health/hosts every 30s.
 *
 * Hidden when no workhorses are registered anywhere (no pills to show).
 */
import { useEffect, useState } from "react";

type Status = "alive" | "stale" | "down";
type HostHealth = {
  host: string;
  status: Status;
  activeHost: string | null;
  lastHeartbeat: string | null;
  ageSeconds: number | null;
  workhorseCount: number;
};

const POLL_MS = 30_000;

const DOT: Record<Status, string> = {
  alive: "🟢",
  stale: "🟡",
  down: "🔴",
};

const LABEL: Record<Status, string> = {
  alive: "alive",
  stale: "stale",
  down: "down",
};

export function SyncHealthPill() {
  const [hosts, setHosts] = useState<HostHealth[] | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/health/hosts", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { hosts: HostHealth[] };
        if (!cancelled) setHosts(data.hosts);
      } catch {
        // swallow — pill stays on last good state
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Re-render every 10s so the relative age label ticks even when the
  // backend payload is unchanged.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  if (!hosts || hosts.length === 0) return null;

  return (
    <div
      style={{
        padding: "6px 8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        className="muted small"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "0 4px 2px",
        }}
      >
        Sync
      </div>
      {hosts.map((h) => (
        <div
          key={h.host}
          title={
            h.lastHeartbeat
              ? `last beat: ${h.lastHeartbeat}\nworkhorses on host: ${h.workhorseCount}`
              : "no heartbeat recorded"
          }
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            padding: "4px 6px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "color-mix(in oklab, var(--paper) 92%, transparent)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            }}
          >
            <span style={{ fontSize: 11 }}>{DOT[h.status]}</span>
            <span>{h.host}</span>
            <span
              className="muted"
              style={{ marginLeft: "auto", fontSize: 10 }}
            >
              {LABEL[h.status]}
            </span>
          </div>
          <div
            className="muted"
            style={{ fontSize: 10.5, paddingLeft: 18, lineHeight: 1.3 }}
          >
            {h.activeHost ? <>on: {h.activeHost} · </> : null}
            {h.ageSeconds === null ? "never" : relAge(h.ageSeconds)}
          </div>
        </div>
      ))}
    </div>
  );
}

function relAge(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
