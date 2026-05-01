import { NextRequest, NextResponse } from "next/server";
import { runHeartbeat } from "@/lib/brain/heartbeat";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    force?: boolean;
  };
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const result = await runHeartbeat(body.projectId, { force: body.force === true });
  if ("error" in result && !result.ok) {
    return NextResponse.json(
      { error: result.error, jobId: result.jobId },
      { status: 500 },
    );
  }
  return NextResponse.json(result);
}
