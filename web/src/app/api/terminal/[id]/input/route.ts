/**
 * POST /api/terminal/[id]/input — write keystrokes to a PTY's stdin.
 * Body: { data: string }. `data` is raw terminal input (including control
 * bytes like \r, \x03 for Ctrl-C) exactly as xterm.js emits it.
 */

import { NextResponse } from "next/server";
import { terminalEnabled } from "@/lib/config";
import { writeInput } from "@/lib/server/terminalSessions";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!terminalEnabled()) {
    return NextResponse.json({ error: "terminal disabled" }, { status: 404 });
  }

  const { id } = await params;
  let data: string;
  try {
    const body = (await req.json()) as { data?: unknown };
    if (typeof body?.data !== "string") {
      return NextResponse.json({ error: "data must be a string" }, { status: 400 });
    }
    data = body.data;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const ok = writeInput(id, data);
  if (!ok) {
    return NextResponse.json(
      { error: "session not found or already exited" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
