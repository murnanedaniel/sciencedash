import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assembleBrief } from "@/lib/brain/memory";
import { resolveProject } from "@/lib/ingest/projectMatch";

export const dynamic = "force-dynamic";

/**
 * GET /api/context/slim?cwd=...&gitRemote=... — the slim project context the
 * SessionStart hook injects. Resolves the project robustly (git remote first,
 * then localPath). Confident match -> the project brief + recent decisions.
 * Ambiguous/no match but plausible candidates -> a short note listing them so
 * the session can propose + confirm. Otherwise -> empty (no injection).
 */
export async function GET(req: NextRequest) {
  const cwd = (req.nextUrl.searchParams.get("cwd") || "").trim();
  const gitRemote = (req.nextUrl.searchParams.get("gitRemote") || "").trim() || null;
  if (!cwd && !gitRemote) return NextResponse.json({ context: "", projectId: null });

  const resolved = await resolveProject({ cwd, gitRemote });

  if (resolved.projectId && resolved.confident) {
    const [brief, decisions] = await Promise.all([
      assembleBrief(resolved.projectId),
      prisma.decision.findMany({
        where: { projectId: resolved.projectId },
        orderBy: { at: "desc" },
        take: 3,
        select: { kind: true, rationale: true },
      }),
    ]);
    let context = `## ScienceDash — project context\n\n${brief}`;
    if (decisions.length) {
      context +=
        `\n\n### Recent decisions\n` +
        decisions.map((d) => `- (${d.kind}) ${d.rationale ?? ""}`).join("\n");
    }
    context += `\n\n_The \`sciencedash\` skill can search your past conversations across machines, read project context, and log decisions._`;
    return NextResponse.json({ context, projectId: resolved.projectId });
  }

  if (resolved.candidates.length) {
    const list = resolved.candidates.map((c) => `- ${c.title}  \`${c.id}\``).join("\n");
    const context =
      `## ScienceDash\n\nThis session isn't confidently tied to one project. It may belong to:\n${list}\n\n` +
      `If it does, you can note that (the \`sciencedash\` skill can search past conversations and log decisions; the conversation can be assigned to a project from the dashboard).`;
    return NextResponse.json({ context, projectId: null, candidates: resolved.candidates });
  }

  // No project signal — inject nothing (avoid noise in unrelated dirs). The
  // sciencedash skill is still available on demand via its own description.
  return NextResponse.json({ context: "", projectId: null });
}
