import { NextRequest, NextResponse } from "next/server";
import { runJobOnce } from "@/lib/worker";
import type { JobKind } from "@/generated/prisma/client";

export async function POST(req: NextRequest) {
  const { kind } = (await req.json()) as { kind: JobKind };
  const ok = new Set(["wandb_pull", "github_pull", "stall_detect"]);
  if (!ok.has(kind))
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  try {
    await runJobOnce(kind);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: err }, { status: 500 });
  }
}
