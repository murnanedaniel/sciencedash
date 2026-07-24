/**
 * POST /api/terminal/session — spawn a new PTY shell, return its id.
 *
 * Auth is enforced upstream by proxy.ts (cookie or bearer). The feature
 * itself is gated by SCIENCEDASH_TERMINAL_ENABLED so a public clone never
 * exposes a shell. Body (optional): { cols, rows } for the initial size.
 */

import { NextResponse } from "next/server";
import { terminalEnabled } from "@/lib/config";
import { createSession } from "@/lib/server/terminalSessions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!terminalEnabled()) {
    return NextResponse.json({ error: "terminal disabled" }, { status: 404 });
  }

  let cols: number | undefined;
  let rows: number | undefined;
  try {
    const body = (await req.json()) as { cols?: number; rows?: number };
    cols = typeof body?.cols === "number" ? body.cols : undefined;
    rows = typeof body?.rows === "number" ? body.rows : undefined;
  } catch {
    // no body / invalid JSON — fall back to defaults
  }

  const result = await createSession({ cols, rows });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ id: result.id, pid: result.pid });
}
