import { NextRequest, NextResponse } from "next/server";
import { startRepoQuickstart } from "@/lib/server/agentActions";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    projectId?: string;
    name?: string;
    instructions?: string;
    isPrivate?: boolean;
    template?: string;
  };
  if (!body.projectId || typeof body.projectId !== "string") {
    return NextResponse.json(
      { error: "projectId required" },
      { status: 400 },
    );
  }
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const result = await startRepoQuickstart({
    projectId: body.projectId,
    name: body.name,
    instructions: body.instructions ?? "",
    isPrivate: body.isPrivate,
    template: body.template,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ jobId: result.jobId });
}
