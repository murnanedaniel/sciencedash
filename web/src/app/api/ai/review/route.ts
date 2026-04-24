import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callClaudeJson, runAi } from "@/lib/ai/client";

type ReviewOutput = {
  diagnosis: string;
  recommendation: "narrow" | "promote_to_paper" | "park" | "escalate_budget" | "continue";
  proposedPatches: Array<{ path: string; value: string }>;
  rationale: string;
};

export async function POST(req: NextRequest) {
  const { projectId } = (await req.json()) as { projectId: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      tags: { select: { name: true } },
      hypotheses: {
        include: {
          runs: {
            orderBy: { endedAt: "desc" },
            take: 6,
            include: { metrics: { include: { definition: true } } },
          },
        },
      },
      metricDefinitions: true,
      checkIns: { orderBy: { createdAt: "desc" }, take: 5 },
      decisions: { orderBy: { at: "desc" }, take: 10 },
    },
  });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const payload = JSON.stringify(
    {
      project: {
        title: project.title,
        tags: project.tags.map((t) => t.name),
        status: project.status,
        description: project.description,
        hypothesis: project.hypothesis,
        figuresOfMerit: project.figuresOfMerit,
        timeline: project.timeline,
        nextSteps: project.nextSteps,
        blockers: project.blockers,
        narrativeReadiness: project.narrativeReadiness,
        narrativeReadinessNote: project.narrativeReadinessNote,
        updatedAt: project.updatedAt,
      },
      primaryMetric: project.metricDefinitions.find((m) => m.isPrimary),
      hypotheses: project.hypotheses.map((h) => ({
        title: h.title,
        statement: h.statement,
        status: h.status,
        verdict: h.verdict,
        budget: h.computeBudgetGpuHours,
        runs: h.runs.map((r) => ({
          name: r.name,
          endedAt: r.endedAt,
          gpuH: r.computeGpuHours,
          metrics: r.metrics.map((m) => ({
            name: m.definition.name,
            value: m.value,
            unit: m.definition.unit,
          })),
        })),
      })),
      recentCheckIns: project.checkIns.map((c) => ({
        at: c.createdAt,
        body: c.bodyMd,
        source: c.source,
      })),
      recentDecisions: project.decisions.map((d) => ({
        at: d.at,
        kind: d.kind,
        rationale: d.rationale,
      })),
    },
    null,
    2,
  );

  const result = await runAi("ai_review", projectId, async () =>
    callClaudeJson<ReviewOutput>("critical-review", payload),
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  const out = result.out.parsed;
  await prisma.checkIn.create({
    data: {
      scope: "project",
      projectId,
      source: "ai",
      bodyMd: out.rationale,
      proposedPatchJson: JSON.stringify({
        diagnosis: out.diagnosis,
        recommendation: out.recommendation,
        rationale: out.rationale,
        proposedPatches: out.proposedPatches,
        costUsd: result.out.costUsd,
      }),
    },
  });

  return NextResponse.json({
    ok: true,
    recommendation: out.recommendation,
    costUsd: result.out.costUsd,
  });
}
