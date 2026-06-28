import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assembleBrief } from "@/lib/brain/memory";

export const dynamic = "force-dynamic";

/**
 * GET /api/context/slim?cwd=... — the slim project context the SessionStart hook
 * injects into every Claude Code session. Resolves cwd -> project and returns
 * the tier-1 brief (assembleBrief) plus the few most recent decisions. Empty if
 * the cwd isn't a known project (the hook then injects nothing).
 */
export async function GET(req: NextRequest) {
  const cwd = (req.nextUrl.searchParams.get("cwd") || "").trim();
  if (!cwd) return NextResponse.json({ context: "", projectId: null });

  const projectId = await resolveProjectId(cwd);
  if (!projectId) return NextResponse.json({ context: "", projectId: null });

  const [brief, decisions] = await Promise.all([
    assembleBrief(projectId),
    prisma.decision.findMany({
      where: { projectId },
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

  return NextResponse.json({ context, projectId });
}

/** cwd -> Project via Project.localPath (longest prefix wins). */
async function resolveProjectId(cwd: string): Promise<string | null> {
  const projects = await prisma.project.findMany({
    where: { localPath: { not: null } },
    select: { id: true, localPath: true },
  });
  let best: { id: string; len: number } | null = null;
  for (const p of projects) {
    const lp = p.localPath as string;
    const prefix = lp.endsWith("/") ? lp : lp + "/";
    if (cwd === lp || cwd.startsWith(prefix)) {
      if (!best || lp.length > best.len) best = { id: p.id, len: lp.length };
    }
  }
  return best?.id ?? null;
}
