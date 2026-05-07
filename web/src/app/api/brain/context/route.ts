import { NextResponse } from "next/server";
import { buildBrainChatContext } from "@/lib/brain/chat-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/brain/context — current global brain context as markdown.
 *
 * Returns the same primer rendered into the brain-chat CHAT_CONTEXT.md:
 * programmes, projects (incl blockers + nextSteps), recent agent
 * messages, last few summarised brain chats. The brain-chat launcher
 * fetches this over the Funnel; a future global-heartbeat meta-pass
 * can call `buildBrainChatContext()` directly in-process.
 *
 * Auth: gated by the proxy (Bearer or session cookie) like every other
 * /api/* route.
 */
export async function GET() {
  const md = await buildBrainChatContext();
  return new NextResponse(md, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
