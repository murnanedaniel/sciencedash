import { NextRequest, NextResponse } from "next/server";
import { runCriticalReview } from "@/lib/server/agentActions";

export async function POST(req: NextRequest) {
  const { projectId } = (await req.json()) as { projectId?: string };
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const result = await runCriticalReview(projectId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, jobId: result.jobId },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    recommendation: result.recommendation,
    costUsd: result.costUsd,
  });
}
