import { NextResponse } from "next/server";
import { getAgentAbort } from "@/lib/worker";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctrl = getAgentAbort(id);
  if (!ctrl) {
    return NextResponse.json(
      { error: "job is not running (or finished before abort reached)" },
      { status: 404 },
    );
  }
  ctrl.abort(new Error("aborted by user"));
  return NextResponse.json({ ok: true });
}
