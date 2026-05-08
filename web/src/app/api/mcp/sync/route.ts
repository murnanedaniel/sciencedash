/**
 * Workhorse sync endpoint.
 *
 * Called by the cron-driven `sync.py` running on each workhorse host (e.g.
 * Perlmutter login node). One round-trip per minute per workhorse:
 *
 * IN  (POST body):
 *   {
 *     host: "perlmutter",
 *     projectId: "cmockX",
 *     sessionName: "sd-cmockX",
 *     outbox: [
 *       {at, kind: "heartbeat", source: "sync"|"claude"},
 *       {at, kind: "tool_call", name: "post_message", args: {...}},
 *       ...
 *     ],
 *     lastDirectiveId?: "..."   // cursor; return directives newer than this
 *   }
 *
 * OUT:
 *   {
 *     ack: <count>,
 *     toolResults: [...],
 *     directives: [
 *       {id, createdAt, body, payloadJson}
 *     ]
 *   }
 *
 * Heartbeats update `Workhorse.lastHeartbeat` / `lastClaudeBeat`. Tool
 * calls execute against the same MCP registry as `/api/mcp`. Directives
 * are unread AgentMessages addressed to this workhorse (kind=directive,
 * source matches `dashboard@<host>:<session>`); they're marked read on
 * delivery.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callTool } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

type OutboxItem =
  | { at: string; kind: "heartbeat"; source: "sync" | "claude" }
  | {
      at: string;
      kind: "tool_call";
      name: string;
      args?: Record<string, unknown>;
    };

type SyncRequest = {
  host?: string;
  projectId?: string;
  sessionName?: string;
  /** Absolute path to the project's repo on this workhorse. Persisted in
   *  Workhorse.configJson so the dashboard can render copy-paste tmux
   *  commands without the user retyping the path. */
  repo?: string;
  /** Whether the project's Claude tmux session was alive when this
   *  tick ran (or null if tmux isn't on the host). Direct liveness
   *  signal — used by WorkhorsesPanel to derive 🟢/🔴 immediately
   *  rather than inferring from MCP-call timestamps. */
  tmuxAlive?: boolean | null;
  /** Whether the `claude` binary is alive in the pane's process tree.
   *  Lets us show 🟢 (vs 🟡) when Claude is doing off-app work that
   *  doesn't call ScienceDash MCP tools. Null if not measurable. */
  claudeBusy?: boolean | null;
  /** Actual hostname running sync.py (may differ from logical `host` on
   *  round-robin clusters: `host` is "perlmutter" but `activeHost` is
   *  e.g. "login01"). Spawned sd-<projectId> tmux lives on this host. */
  activeHost?: string;
  outbox?: OutboxItem[];
  lastDirectiveId?: string;
};

export async function POST(req: NextRequest) {
  let body: SyncRequest;
  try {
    body = (await req.json()) as SyncRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const host = typeof body.host === "string" ? body.host.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const sessionName = typeof body.sessionName === "string" ? body.sessionName.trim() : "";
  if (!host || !projectId || !sessionName) {
    return NextResponse.json(
      { error: "host, projectId, sessionName are required" },
      { status: 400 },
    );
  }

  // Verify project exists.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: `project not found: ${projectId}` }, { status: 404 });
  }

  // Flap-prevention: if a stop_session directive is pending for this
  // (host, sessionName), refuse to re-upsert / re-update the Workhorse
  // row. Without this guard, removeWorkhorseAction's optimistic delete
  // gets undone by the upsert below — the directive then runs and
  // sync.py stops beating, but the row that just flapped back stays
  // visible until the next manual cleanup.
  //
  // We match by `endsWith: @host:session` so directives queued by
  // either the dashboard ("dashboard@host:session") or the brain via
  // MCP ("mcp@host:session") both register here.
  const pendingStopSession = await prisma.agentMessage.findFirst({
    where: {
      projectId,
      kind: "directive",
      body: "stop_session",
      source: { endsWith: `@${host}:${sessionName}` },
      readAt: null,
    },
    select: { id: true },
  });

  // Upsert workhorse row (auto-register on first sync). Capture the
  // workhorse-side repo path AND the tmux session liveness so the
  // dashboard can render copy-paste tmux commands and derive accurate
  // 🟢/🔴 state.
  const repo = typeof body.repo === "string" && body.repo.trim() ? body.repo.trim() : undefined;
  const tmuxAlive =
    body.tmuxAlive === true ? true : body.tmuxAlive === false ? false : undefined;
  const claudeBusy =
    body.claudeBusy === true ? true : body.claudeBusy === false ? false : undefined;
  const activeHost =
    typeof body.activeHost === "string" && body.activeHost.trim()
      ? body.activeHost.trim()
      : undefined;
  const configFields: Record<string, unknown> = {};
  if (repo) configFields.repo = repo;
  if (tmuxAlive !== undefined) {
    configFields.tmuxAlive = tmuxAlive;
    configFields.tmuxCheckedAt = new Date().toISOString();
  }
  if (claudeBusy !== undefined) configFields.claudeBusy = claudeBusy;
  if (activeHost) configFields.activeHost = activeHost;
  const configJson = Object.keys(configFields).length > 0 ? JSON.stringify(configFields) : undefined;
  if (!pendingStopSession) {
    await prisma.workhorse.upsert({
      where: { host_sessionName: { host, sessionName } },
      create: { host, projectId, sessionName, configJson: configJson ?? null },
      update: {
        // projectId is part of identity for create-only; on updates we
        // could in principle re-link if the user moved the session to
        // another project, but in practice (host, sessionName) → project
        // is stable, so just refresh the live fields.
        ...(configJson ? { configJson } : {}),
      },
    });
  }

  const outbox = Array.isArray(body.outbox) ? body.outbox : [];
  let lastSyncBeat: Date | null = null;
  let lastClaudeBeat: Date | null = null;
  const toolResults: Array<{
    name: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }> = [];

  for (const item of outbox) {
    if (!item || typeof item !== "object") continue;
    const at = typeof item.at === "string" ? new Date(item.at) : new Date();
    if (item.kind === "heartbeat") {
      if (item.source === "sync") {
        if (!lastSyncBeat || at > lastSyncBeat) lastSyncBeat = at;
      } else if (item.source === "claude") {
        if (!lastClaudeBeat || at > lastClaudeBeat) lastClaudeBeat = at;
      }
    } else if (item.kind === "tool_call") {
      const r = await callTool(item.name, item.args ?? {});
      // A successful tool call also implies Claude is alive.
      if (!r.isError && (!lastClaudeBeat || at > lastClaudeBeat)) lastClaudeBeat = at;
      toolResults.push({
        name: item.name,
        ok: !r.isError,
        result: r.structuredContent ?? r.content,
        error: r.isError ? r.content[0]?.type === "text" ? r.content[0].text : "tool error" : undefined,
      });
    }
  }

  // Always treat receipt of a sync POST as evidence that the host is reachable.
  const now = new Date();
  if (!lastSyncBeat || now > lastSyncBeat) lastSyncBeat = now;

  if (!pendingStopSession) {
    await prisma.workhorse.update({
      where: { host_sessionName: { host, sessionName } },
      data: {
        lastHeartbeat: lastSyncBeat,
        ...(lastClaudeBeat ? { lastClaudeBeat } : {}),
      },
    });
  }

  // Pull any unread directives addressed to this workhorse. Match by
  // suffix so dashboard-queued (`dashboard@…`) and MCP-queued (`mcp@…`)
  // directives are both delivered.
  const directives = await prisma.agentMessage.findMany({
    where: {
      projectId,
      kind: "directive",
      source: { endsWith: `@${host}:${sessionName}` },
      readAt: null,
      ...(body.lastDirectiveId
        ? { id: { not: body.lastDirectiveId } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 32,
  });

  if (directives.length > 0) {
    await prisma.agentMessage.updateMany({
      where: { id: { in: directives.map((d) => d.id) } },
      data: { readAt: new Date() },
    });
  }

  return NextResponse.json({
    ack: outbox.length,
    toolResults,
    directives: directives.map((d) => ({
      id: d.id,
      createdAt: d.createdAt,
      body: d.body,
      payloadJson: d.payloadJson,
    })),
  });
}

/** GET returns a small description so curl-checks land somewhere useful. */
export async function GET() {
  return NextResponse.json({
    endpoint: "sciencedash-mcp/sync",
    transport: "http+json",
    method: "POST",
    docs: "/docs/workhorse-protocol.md",
  });
}
