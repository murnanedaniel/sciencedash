import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redact } from "@/lib/ingest/redact";
import { resolveProject } from "@/lib/ingest/projectMatch";
import { isNoiseCwd } from "@/lib/ingest/noise";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/transcript — the ambient context layer's ingest endpoint.
 * The per-machine shipper (tools/transcript-sync/ship.py) tails Claude Code
 * session JSONLs, extracts + redacts text, and posts incremental batches here.
 * Proxy-gated (bearer) like every /api route. Upserts a Thread by sessionId,
 * appends Turns, associates to a Project by cwd, and FTS stays in sync via the
 * ThreadFTS triggers (on Thread.bodyText changes).
 *
 * Body: { machine, sessionId, cwd, title?, events: [{role,text?,toolName?,at?}],
 *         fromLine?, totalLines? }
 */
type InEvent = { role?: string; text?: string; toolName?: string | null; at?: string | null };
type Body = {
  machine?: string;
  sessionId?: string;
  cwd?: string;
  gitRemote?: string | null;
  title?: string | null;
  events?: InEvent[];
  fromLine?: number;
  totalLines?: number;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const machine = body.machine?.trim();
  const sessionId = body.sessionId?.trim();
  const cwd = body.cwd?.trim();
  if (!machine || !sessionId || !cwd) {
    return NextResponse.json({ error: "machine, sessionId, cwd are required" }, { status: 400 });
  }
  // Drop ScienceDash's own spawned agent runs (ephemeral temp dirs) — noise.
  if (isNoiseCwd(cwd)) {
    return NextResponse.json({ ok: true, sessionId, skipped: "noise" });
  }
  const events = Array.isArray(body.events) ? body.events : [];
  const gitRemote = body.gitRemote?.trim() || null;

  const resolved = await resolveProject({ cwd, gitRemote });

  const result = await prisma.$transaction(async (tx) => {
    let thread = await tx.thread.findUnique({ where: { sessionId } });
    if (!thread) {
      thread = await tx.thread.create({
        data: {
          sessionId,
          machine,
          cwd,
          gitRemote,
          projectId: resolved.projectId,
          title: body.title ?? null,
        },
      });
    }

    // Dedup: the shipper resumes from thread.shippedLines; ignore re-sends of
    // already-stored prefixes.
    const fromLine = body.fromLine ?? thread.shippedLines;
    if (fromLine < thread.shippedLines) {
      return { appended: 0, skipped: true, projectId: thread.projectId };
    }

    let idx = thread.turnCount;
    let firstAt = thread.firstAt;
    let lastAt = thread.lastAt;
    const turnData: {
      threadId: string; idx: number; role: string; text: string; toolName: string | null; at: Date | null;
    }[] = [];
    const pieces: string[] = [];
    for (const ev of events) {
      const text = redact(ev.text ?? "");
      const at = ev.at ? new Date(ev.at) : null;
      if (at && !Number.isNaN(at.getTime())) {
        if (!firstAt || at < firstAt) firstAt = at;
        if (!lastAt || at > lastAt) lastAt = at;
      }
      turnData.push({
        threadId: thread.id,
        idx: idx++,
        role: ev.role || "user",
        text,
        toolName: ev.toolName ?? null,
        at: at && !Number.isNaN(at.getTime()) ? at : null,
      });
      if (text) pieces.push(text);
    }
    if (turnData.length) await tx.turn.createMany({ data: turnData });

    const newBody =
      thread.bodyText + (pieces.length ? (thread.bodyText ? "\n" : "") + pieces.join("\n") : "");

    await tx.thread.update({
      where: { id: thread.id },
      data: {
        title: body.title ?? thread.title,
        machine,
        cwd,
        gitRemote: thread.gitRemote ?? gitRemote,
        projectId: thread.projectId ?? resolved.projectId,
        turnCount: idx,
        bodyText: newBody,
        shippedLines: body.totalLines ?? thread.shippedLines,
        firstAt,
        lastAt,
      },
    });
    return { appended: turnData.length, skipped: false, projectId: thread.projectId ?? resolved.projectId };
  });

  return NextResponse.json({ ok: true, sessionId, ...result });
}
