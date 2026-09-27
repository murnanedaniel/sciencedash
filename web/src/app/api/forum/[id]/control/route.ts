/**
 * POST /api/forum/[id]/control — pause / resume / abort / end / resync.
 *
 * The kill switch and its neighbours, kept separate from the message path so
 * "stop this now" never has to queue behind composing a message.
 */

import { NextRequest } from "next/server";
import { forumEnabled } from "@/lib/config";
import { control, type ForumControl } from "@/lib/forum/sessions";

export const dynamic = "force-dynamic";

const ACTIONS: ReadonlySet<string> = new Set([
  "pause",
  "resume",
  "abort",
  "end",
  "resync",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!forumEnabled()) return jsonError(404, "forum disabled");

  const { id } = await params;

  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return jsonError(400, "invalid JSON");
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return jsonError(400, `action must be one of ${[...ACTIONS].join(", ")}`);
  }

  const result = await control(id, action as ForumControl);
  if (!result.ok) return jsonError(400, result.error ?? "control failed");

  return Response.json({ ok: true });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
