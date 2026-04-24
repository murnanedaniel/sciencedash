import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callClaudeJson, runAi } from "@/lib/ai/client";

type AuditOutput = {
  diagnosis: string;
  actions: Array<{
    kind: "promote_to_paper" | "park" | "escalate_budget" | "start_new_exploit";
    projectTitle: string;
    rationale: string;
  }>;
  rationale: string;
};

export async function POST() {
  const projects = await prisma.project.findMany({
    include: {
      hypotheses: { include: { runs: true } },
      decisions: { orderBy: { at: "desc" }, take: 3 },
    },
  });
  const papers = await prisma.paper.findMany({
    include: { primaryProject: { select: { title: true } } },
  });

  const payload = JSON.stringify(
    {
      projects: projects.map((p) => ({
        title: p.title,
        type: p.type,
        status: p.status,
        narrativeReadiness: p.narrativeReadiness,
        hypotheses: p.hypotheses.length,
        runs: p.hypotheses.flatMap((h) => h.runs).length,
        daysSinceUpdate: Math.floor((Date.now() - p.updatedAt.getTime()) / 86_400_000),
        lastDecision: p.decisions[0]?.kind ?? null,
      })),
      papers: papers.map((pa) => ({
        title: pa.title,
        status: pa.status,
        project: pa.primaryProject?.title,
      })),
    },
    null,
    2,
  );

  const result = await runAi("ai_audit", null, async () =>
    callClaudeJson<AuditOutput>("outer-loop-audit", payload),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  const out = result.out.parsed;
  await prisma.checkIn.create({
    data: {
      scope: "portfolio",
      source: "ai",
      bodyMd: out.rationale,
      proposedPatchJson: JSON.stringify({
        diagnosis: out.diagnosis,
        recommendation: "audit",
        rationale: out.rationale,
        proposedPatches: out.actions.map((a) => ({
          path: `audit.${a.kind}`,
          value: `${a.projectTitle}: ${a.rationale}`,
        })),
        costUsd: result.out.costUsd,
      }),
    },
  });

  return NextResponse.json({ ok: true, costUsd: result.out.costUsd });
}
