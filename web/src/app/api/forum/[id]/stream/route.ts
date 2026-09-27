/**
 * GET /api/forum/[id]/stream — SSE feed of a forum.
 *
 * On connect: a `snapshot` event carrying the whole transcript from the DB
 * (the source of truth — no in-memory replay buffer needed, unlike the PTY
 * terminal), then live events as turns run.
 *
 * Server→client only. Human messages and controls go back via sibling POSTs,
 * for the same reason the terminal does it: `next start` doesn't expose the
 * WebSocket upgrade handler through route handlers.
 */

import { forumEnabled } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import {
  forumAttachmentsDir,
  liveState,
  loadTranscript,
  parkNote,
  reconcileStale,
  resolveWorkdir,
  subscribe,
  type ForumStreamEvent,
} from "@/lib/forum/sessions";

export const dynamic = "force-dynamic";
// Long-lived stream; a forum can sit idle between turns for a long time.
export const maxDuration = 3600;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!forumEnabled()) {
    return new Response(JSON.stringify({ error: "forum disabled" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const { id } = await params;
  await reconcileStale(id);
  const forum = await prisma.forum.findUnique({
    where: { id },
    include: {
      participants: true,
      project: { select: { localPath: true } },
    },
  });
  if (!forum) {
    return new Response(JSON.stringify({ error: "no such forum" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const transcript = await loadTranscript(id);
  const last = transcript[transcript.length - 1] ?? null;
  const workdir = await resolveWorkdir(forum);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };
      const comment = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Flush immediately so a buffering reverse proxy (cloudflared,
      // Tailscale, nginx) establishes the stream instead of holding it.
      comment("connected");

      send("snapshot", {
        forum: {
          id: forum.id,
          title: forum.title,
          topic: forum.topic,
          status: forum.status,
          turnsSpent: forum.turnsSpent,
          turnBudget: forum.turnBudget,
          costUsd: forum.costUsd,
          projectId: forum.projectId,
          note: parkNote(forum, last),
          workdir,
          attachmentsDir: forumAttachmentsDir(id),
        },
        participants: forum.participants.map((p) => ({
          handle: p.handle,
          driver: p.driver,
          model: p.model,
          persona: p.persona,
          seat: p.seat,
          active: p.active,
        })),
        messages: transcript,
        speaking: liveState(id).speaking,
      });

      const onEvent = (e: ForumStreamEvent) => send(e.kind, e);
      const unsubscribe = subscribe(id, onEvent);

      const cleanup = () => {
        unsubscribe();
        req.signal.removeEventListener("abort", onAbort);
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      function onAbort() {
        cleanup();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      }

      req.signal.addEventListener("abort", onAbort);
      // A forum parked waiting for the human produces no traffic; without a
      // heartbeat a proxy with a short read timeout would drop the stream.
      heartbeat = setInterval(() => comment("ping"), 15000);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
