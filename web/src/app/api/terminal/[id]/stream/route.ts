/**
 * GET /api/terminal/[id]/stream — SSE stream of a PTY's output.
 *
 * On connect we replay the session's rolling buffer (so a refresh or
 * reconnect shows current scrollback), then forward live output as it
 * arrives. A `exit` event fires when the shell dies; the stream then closes.
 *
 * Server→client only. Keystrokes and resize go back via sibling POST routes.
 * EventSource can't send an Authorization header, so this leans on the
 * session cookie — which is exactly how browsers hit every other route.
 */

import { terminalEnabled } from "@/lib/config";
import { getSession } from "@/lib/server/terminalSessions";

export const dynamic = "force-dynamic";
// Long-lived stream; don't let the platform time it out early.
export const maxDuration = 3600;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!terminalEnabled()) {
    return new Response(JSON.stringify({ error: "terminal disabled" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return new Response(JSON.stringify({ error: "no such session" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
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

      const onChunk = (chunk: string) => send("data", chunk);
      const onExit = (info: { exitCode: number; signal?: number }) => {
        send("exit", info);
        cleanup();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      const cleanup = () => {
        session.subscribers.delete(onChunk);
        session.exitListeners.delete(onExit);
        req.signal.removeEventListener("abort", onAbort);
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      const onAbort = () => {
        cleanup();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      };

      // 0. Flush a comment immediately so a buffering reverse proxy
      //    (Tailscale, cloudflared, nginx) sees bytes and establishes the
      //    stream right away instead of holding the response.
      comment("connected");

      // 1. Replay current scrollback so the client isn't blank on reconnect.
      //    Distinct `snapshot` event so the client resets its screen before
      //    writing it — otherwise a reconnect would stack a second copy of
      //    the scrollback on top of the first.
      send("snapshot", session.buffer);

      // 2. If the shell already exited, tell the client and close.
      if (session.exited) {
        send("exit", session.exitInfo ?? { exitCode: 0 });
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore
        }
        return;
      }

      // 3. Subscribe to live output + teardown hooks.
      session.subscribers.add(onChunk);
      session.exitListeners.add(onExit);
      req.signal.addEventListener("abort", onAbort);

      // 4. Heartbeat: a shell sits idle at its prompt, so without periodic
      //    traffic a proxy with a short read timeout would drop the stream.
      //    A comment every 15s keeps it alive and is ignored by the client.
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
