import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/search/threads?q=... — full-text search across ingested Claude Code
 * conversation transcripts (the ambient context layer). Ranked by FTS5 bm25,
 * with a snippet. Proxy-gated like every /api route, so the `sciencedash`
 * skill can call it with the bearer token too.
 */
type Row = {
  id: string;
  sessionId: string;
  title: string | null;
  machine: string;
  cwd: string;
  projectId: string | null;
  projectTitle: string | null;
  firstAt: string | number | null;
  lastAt: string | number | null;
  turnCount: number | bigint;
  snippet: string;
};

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const match = toFtsQuery(q);
  if (!match) return NextResponse.json({ q, results: [] });

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT t."id", t."sessionId", t."title", t."machine", t."cwd", t."projectId",
           p."title" AS "projectTitle",
           t."firstAt", t."lastAt", t."turnCount",
           snippet("ThreadFTS", 2, '⟦', '⟧', '…', 12) AS "snippet"
    FROM "ThreadFTS" f
    JOIN "Thread" t ON t."id" = f."threadId"
    LEFT JOIN "Project" p ON p."id" = t."projectId"
    WHERE "ThreadFTS" MATCH ${match}
    ORDER BY rank
    LIMIT 50`;

  const results = rows.map((r) => ({
    sessionId: r.sessionId,
    title: r.title,
    machine: r.machine,
    cwd: r.cwd,
    projectId: r.projectId,
    projectTitle: r.projectTitle,
    firstAt: toIso(r.firstAt),
    lastAt: toIso(r.lastAt),
    turnCount: Number(r.turnCount),
    snippet: r.snippet,
  }));
  return NextResponse.json({ q, count: results.length, results });
}

/** Turn free text into a safe FTS5 MATCH expression: quoted terms, AND-ed. */
function toFtsQuery(q: string): string {
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 12);
  if (!terms.length) return "";
  return terms.map((t) => `"${t}"`).join(" ");
}

function toIso(v: string | number | null): string | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  // SQLite DateTime often comes back as an ISO-ish string already
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
