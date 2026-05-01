import { NextRequest, NextResponse } from "next/server";
import { runLiteratureReview } from "@/lib/server/agentActions";

export async function POST(req: NextRequest) {
  const { projectId, instructions } = (await req.json()) as {
    projectId?: string;
    instructions?: string;
  };
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const trimmed = instructions?.trim().slice(0, 2000) || undefined;
  const result = await runLiteratureReview(projectId, trimmed);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
