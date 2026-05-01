import { NextRequest, NextResponse } from "next/server";
import { runGlobalHeartbeat } from "@/lib/brain/global";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const result = await runGlobalHeartbeat({ force: body.force === true });
  return NextResponse.json(result);
}
