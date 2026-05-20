/**
 * Host-level directive poll for the workhorse sync daemon.
 *
 * Companion to /api/mcp/sync, which is per-(host, project, session). This
 * endpoint exists for directives that need to land on a host BEFORE any
 * project is registered there — currently just `start_session`, the
 * directive that registers a project in the host's local config.json and
 * spawns its tmux session.
 *
 * IN  (POST body):
 *   { host: "perlmutter", activeHost: "login01" }
 *
 * OUT:
 *   { directives: [ { id, projectId, body, payloadJson } ] }
 *
 * Directives are matched by `source` prefix (`dashboard@<host>:` or
 * `mcp@<host>:`) and marked read on delivery. sync.py executes each
 * locally via `_start_session(...)`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type HostSyncRequest = {
  host?: string;
  activeHost?: string;
};

export async function POST(req: NextRequest) {
  let body: HostSyncRequest;
  try {
    body = (await req.json()) as HostSyncRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const host = typeof body.host === "string" ? body.host.trim() : "";
  if (!host) {
    return NextResponse.json({ error: "host is required" }, { status: 400 });
  }

  // Match `dashboard@<host>:` OR `mcp@<host>:` source prefixes. Limited
  // to body="start_session" — other directive bodies (workhorse_tick,
  // revive_session, stop_session) ride the per-project channel.
  const directives = await prisma.agentMessage.findMany({
    where: {
      kind: "directive",
      body: "start_session",
      readAt: null,
      OR: [
        { source: { startsWith: `dashboard@${host}:` } },
        { source: { startsWith: `mcp@${host}:` } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 16,
  });

  if (directives.length > 0) {
    await prisma.agentMessage.updateMany({
      where: { id: { in: directives.map((d) => d.id) } },
      data: { readAt: new Date() },
    });
  }

  return NextResponse.json({
    directives: directives.map((d) => ({
      id: d.id,
      projectId: d.projectId,
      body: d.body,
      payloadJson: d.payloadJson,
      createdAt: d.createdAt,
    })),
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: "sciencedash-mcp/host-sync",
    transport: "http+json",
    method: "POST",
    docs: "/docs/workhorse-protocol.md",
  });
}
