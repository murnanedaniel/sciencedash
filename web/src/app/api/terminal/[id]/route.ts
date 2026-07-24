/**
 * DELETE /api/terminal/[id] — kill a PTY session (the "close terminal"
 * button, and the browser's unload beacon).
 */

import { NextResponse } from "next/server";
import { terminalEnabled } from "@/lib/config";
import { kill } from "@/lib/server/terminalSessions";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!terminalEnabled()) {
    return NextResponse.json({ error: "terminal disabled" }, { status: 404 });
  }
  const { id } = await params;
  kill(id);
  return NextResponse.json({ ok: true });
}
