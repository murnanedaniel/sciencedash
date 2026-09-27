/**
 * POST /api/forum — create a forum and its participants.
 * GET  /api/forum — list forums, newest first.
 *
 * Creation takes a topic and a participant roster. Defaults give you the
 * intended pairing (Claude + Codex) without having to spell it out.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  forumClaudeModel,
  forumCodexModel,
  forumEnabled,
} from "@/lib/config";
import { reconcileStale } from "@/lib/forum/sessions";

export const dynamic = "force-dynamic";

type ParticipantInput = {
  handle?: string;
  driver?: string;
  model?: string;
  persona?: string;
};

type CreateRequest = {
  title?: string;
  topic?: string;
  projectId?: string | null;
  turnBudget?: number;
  participants?: ParticipantInput[];
};

function defaultParticipants(): Array<{
  handle: string;
  driver: "claude" | "codex";
  model: string;
  persona: string;
  seat: number;
}> {
  return [
    {
      handle: "claude",
      driver: "claude",
      model: forumClaudeModel(),
      persona: "",
      seat: 0,
    },
    {
      handle: "codex",
      driver: "codex",
      model: forumCodexModel(),
      persona: "",
      seat: 1,
    },
  ];
}

/** First line of the topic, cut at a word boundary with an ellipsis. */
function titleFromTopic(topic: string): string {
  const firstLine = topic.split("\n")[0].trim();
  if (firstLine.length <= 80) return firstLine;
  const breakAt = firstLine.lastIndexOf(" ", 79);
  return `${firstLine.slice(0, breakAt > 0 ? breakAt : 80)}…`;
}

export async function GET() {
  if (!forumEnabled()) return disabled();
  await reconcileStale();
  const forums = await prisma.forum.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      participants: { select: { handle: true, driver: true, model: true } },
      project: { select: { id: true, title: true } },
      _count: { select: { messages: true } },
    },
  });
  return Response.json({ forums });
}

export async function POST(req: NextRequest) {
  if (!forumEnabled()) return disabled();

  let body: CreateRequest;
  try {
    body = (await req.json()) as CreateRequest;
  } catch {
    return jsonError(400, "invalid JSON");
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return jsonError(400, "topic is required");

  const title =
    (typeof body.title === "string" && body.title.trim()) ||
    titleFromTopic(topic);

  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;
  if (projectId) {
    const exists = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) return jsonError(400, `no such project: ${projectId}`);
  }

  const turnBudget =
    typeof body.turnBudget === "number" && Number.isFinite(body.turnBudget)
      ? Math.min(40, Math.max(1, Math.floor(body.turnBudget)))
      : 6;

  // Roster: caller-supplied or the default Claude+Codex pairing.
  const raw =
    Array.isArray(body.participants) && body.participants.length
      ? body.participants
      : null;

  const participants = raw
    ? raw.map((p, i) => {
        const driver = p.driver === "codex" ? "codex" : "claude";
        const handle =
          (typeof p.handle === "string" && p.handle.trim().toLowerCase()) ||
          driver;
        return {
          handle,
          driver: driver as "claude" | "codex",
          model:
            (typeof p.model === "string" && p.model.trim()) ||
            (driver === "codex" ? forumCodexModel() : forumClaudeModel()),
          persona: typeof p.persona === "string" ? p.persona.trim() : "",
          seat: i,
        };
      })
    : defaultParticipants();

  // "human" is reserved — it's how participants address the researcher.
  if (participants.some((p) => p.handle === "human" || p.handle === "system")) {
    return jsonError(400, '"human" and "system" are reserved handles');
  }
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.handle)) {
      return jsonError(400, `duplicate participant handle: ${p.handle}`);
    }
    seen.add(p.handle);
  }

  const forum = await prisma.forum.create({
    data: {
      title,
      topic,
      projectId,
      turnBudget,
      status: "idle",
      participants: { create: participants },
    },
    include: { participants: true },
  });

  return Response.json({ forum }, { status: 201 });
}

function disabled(): Response {
  return new Response(JSON.stringify({ error: "forum disabled" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
