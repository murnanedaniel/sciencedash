import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callClaudeJson, runAi } from "@/lib/ai/client";

type PolishOutput = { contentMd: string };

export async function POST(req: NextRequest) {
  const { sectionId } = (await req.json()) as { sectionId: string };
  if (!sectionId)
    return NextResponse.json({ error: "sectionId required" }, { status: 400 });

  const s = await prisma.paperSection.findUnique({
    where: { id: sectionId },
    include: { paper: { select: { primaryProjectId: true } } },
  });
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });

  const payload = JSON.stringify({ kind: s.kind, title: s.title, contentMd: s.contentMd });

  const result = await runAi(
    "ai_skeleton",
    s.paper.primaryProjectId,
    async () => callClaudeJson<PolishOutput>("polish", payload),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  await prisma.paperSection.update({
    where: { id: sectionId },
    data: { contentMd: result.out.contentMd },
  });
  return NextResponse.json({ ok: true });
}
