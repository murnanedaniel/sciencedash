/**
 * Per-host sync.py health rollup.
 *
 * One row per remote host registered in the Workhorse table. Aggregates
 * `max(lastHeartbeat)` across all workhorses for that host — that's the
 * freshest beat sync.py made, regardless of which project owns the row.
 * Pulls `activeHost` (the actual login node sync.py is running on) from
 * the configJson of the workhorse with the freshest beat.
 *
 * Used by <SyncHealthPill /> in the sidebar to render a navbar-style
 * status dot for each host. Polling every ~30s is fine; the data is
 * cheap (one Workhorse.findMany + a per-row JSON parse).
 */
import { NextResponse } from "next/server";
import { bridgeStatus } from "@/lib/bridge/reconcile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Status = "alive" | "stale" | "down";

const FRESH_MS = 90_000; // sync.py ticks every ~55s; allow one miss + grace
const STALE_MS = 5 * 60_000; // beyond 5min the loop is genuinely sick

type HostHealth = {
  kind?: "bridge";
  envId?: string | null;
  host: string;
  status: Status;
  activeHost: string | null;
  lastHeartbeat: string | null;
  ageSeconds: number | null;
  workhorseCount: number;
};

export async function GET() {
  const workhorses = await prisma.workhorse.findMany({
    where: { transport: "tmux" },
    select: {
      host: true,
      lastHeartbeat: true,
      configJson: true,
    },
  });

  const byHost = new Map<
    string,
    { lastHeartbeat: Date | null; activeHost: string | null; count: number }
  >();
  for (const w of workhorses) {
    const cur = byHost.get(w.host) ?? {
      lastHeartbeat: null,
      activeHost: null,
      count: 0,
    };
    cur.count += 1;
    if (
      w.lastHeartbeat &&
      (!cur.lastHeartbeat || w.lastHeartbeat > cur.lastHeartbeat)
    ) {
      cur.lastHeartbeat = w.lastHeartbeat;
      cur.activeHost = parseActiveHost(w.configJson);
    }
    byHost.set(w.host, cur);
  }

  const now = Date.now();
  const hosts: HostHealth[] = Array.from(byHost.entries())
    .map(([host, agg]) => {
      const ageMs = agg.lastHeartbeat ? now - agg.lastHeartbeat.getTime() : null;
      const status: Status =
        ageMs === null
          ? "down"
          : ageMs < FRESH_MS
            ? "alive"
            : ageMs < STALE_MS
              ? "stale"
              : "down";
      return {
        host,
        status,
        activeHost: agg.activeHost,
        lastHeartbeat: agg.lastHeartbeat?.toISOString() ?? null,
        ageSeconds: ageMs !== null ? Math.floor(ageMs / 1000) : null,
        workhorseCount: agg.count,
      };
    })
    .sort((a, b) => a.host.localeCompare(b.host));

  const [bridges, rcWorkhorses] = await Promise.all([
    prisma.bridge.findMany(),
    prisma.workhorse.findMany({ where: { transport: "rc" }, select: { bridgeName: true } }),
  ]);
  for (const b of bridges) {
    const status = bridgeStatus({ ...b, liveSessions: [] }, new Date(now));
    hosts.push({
      kind: "bridge", envId: b.envId, host: b.name,
      status: status === "fresh" ? "alive" : status,
      activeHost: b.node, lastHeartbeat: b.lastBeat?.toISOString() ?? null,
      ageSeconds: b.lastBeat ? Math.floor((now - b.lastBeat.getTime()) / 1000) : null,
      workhorseCount: rcWorkhorses.filter((w) => w.bridgeName === b.name).length,
    });
  }
  hosts.sort((a, b) => a.host.localeCompare(b.host));
  return NextResponse.json({ hosts });
}

function parseActiveHost(configJson: string | null): string | null {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson) as { activeHost?: unknown };
    return typeof parsed.activeHost === "string" ? parsed.activeHost : null;
  } catch {
    return null;
  }
}
