/**
 * POST /api/terminal/[id]/resize — resize the PTY window.
 * Body: { cols, rows }. Sent whenever xterm's fit addon recomputes the
 * grid so line-wrapping and full-screen TUIs render correctly.
 */

import { NextResponse } from "next/server";
import { terminalEnabled } from "@/lib/config";
import { resize } from "@/lib/server/terminalSessions";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!terminalEnabled()) {
    return NextResponse.json({ error: "terminal disabled" }, { status: 404 });
  }

  const { id } = await params;
  let cols: number;
  let rows: number;
  try {
    const body = (await req.json()) as { cols?: unknown; rows?: unknown };
    if (typeof body?.cols !== "number" || typeof body?.rows !== "number") {
      return NextResponse.json(
        { error: "cols and rows must be numbers" },
        { status: 400 },
      );
    }
    cols = body.cols;
    rows = body.rows;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const ok = resize(id, cols, rows);
  if (!ok) {
    return NextResponse.json(
      { error: "session not found or already exited" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
