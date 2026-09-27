/**
 * POST /api/forum/[id]/message — the human speaks.
 *
 * This is the interjection path. It aborts whatever turn is in flight so the
 * message lands now rather than after the current participant finishes, then
 * restarts the scheduler with a fresh turn budget.
 */

import { NextRequest } from "next/server";
import { forumEnabled } from "@/lib/config";
import { postHumanMessage } from "@/lib/forum/sessions";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!forumEnabled()) return jsonError(404, "forum disabled");

  const { id } = await params;

  let body: { text?: string };
  try {
    body = (await req.json()) as { text?: string };
  } catch {
    return jsonError(400, "invalid JSON");
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError(400, "text is required");

  const message = await postHumanMessage(id, text);
  if (!message) return jsonError(404, "no such forum, or it has ended");

  return Response.json({ message });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
