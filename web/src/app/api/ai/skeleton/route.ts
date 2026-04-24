import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callClaudeJson, runAi } from "@/lib/ai/client";

type SkeletonOutput = {
  intro: string;
  method: string;
  experiments: string;
  results: string;
};

export async function POST(req: NextRequest) {
  const { paperId } = (await req.json()) as { paperId: string };
  if (!paperId) return NextResponse.json({ error: "paperId required" }, { status: 400 });

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      sections: { orderBy: { order: "asc" } },
      primaryProject: true,
      hypotheses: {
        include: {
          hypothesis: {
            include: {
              runs: {
                include: { metrics: { include: { definition: true } } },
                orderBy: { endedAt: "desc" },
                take: 8,
              },
            },
          },
        },
      },
    },
  });
  if (!paper) return NextResponse.json({ error: "not found" }, { status: 404 });

  const payload = JSON.stringify(
    {
      title: paper.title,
      abstract: paper.abstract,
      project: paper.primaryProject?.title,
      hypotheses: paper.hypotheses.map((hp) => ({
        title: hp.hypothesis.title,
        statement: hp.hypothesis.statement,
        verdict: hp.hypothesis.verdict,
        runs: hp.hypothesis.runs.map((r) => ({
          metrics: r.metrics.map((m) => ({ name: m.definition.name, value: m.value })),
        })),
      })),
    },
    null,
    2,
  );

  const result = await runAi("ai_skeleton", paper.primaryProjectId, async () =>
    callClaudeJson<SkeletonOutput>("skeleton", payload),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  const wants: Array<[string, string]> = [
    ["intro", result.out.parsed.intro],
    ["method", result.out.parsed.method],
    ["experiments", result.out.parsed.experiments],
    ["results", result.out.parsed.results],
  ];
  for (const [kind, content] of wants) {
    const s = paper.sections.find((x) => x.kind === kind);
    if (s) {
      await prisma.paperSection.update({
        where: { id: s.id },
        data: { contentMd: content },
      });
    }
  }
  return NextResponse.json({ ok: true, costUsd: result.out.costUsd });
}
