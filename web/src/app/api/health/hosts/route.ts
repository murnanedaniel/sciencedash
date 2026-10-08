import { NextResponse } from "next/server";
import { bridgeStatus } from "@/lib/bridge/reconcile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [bridges, workhorses] = await Promise.all([
    prisma.bridge.findMany({ orderBy: { name: "asc" } }),
    prisma.workhorse.findMany({ select: { bridgeName: true } }),
  ]);
  const now = new Date();
  const hosts = bridges.map((b) => {
    const status = bridgeStatus({ ...b, liveSessions: [] }, now);
    return {
      kind: "bridge", envId: b.envId, host: b.name,
      status: status === "fresh" ? "alive" : status,
      activeHost: b.node, lastHeartbeat: b.lastBeat?.toISOString() ?? null,
      ageSeconds: b.lastBeat ? Math.floor((now.getTime() - b.lastBeat.getTime()) / 1000) : null,
      workhorseCount: workhorses.filter((w) => w.bridgeName === b.name).length,
    };
  });
  return NextResponse.json({ hosts });
}
