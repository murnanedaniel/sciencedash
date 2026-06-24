import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import os from "node:os";
import { autoDeployEnabled, deployScript } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * POST /api/deploy/trigger — manually invoke deploy.sh. Same script the
 * systemd timer runs on a schedule; the manual button is a "skip the
 * 90-second wait" affordance.
 *
 * Spawned detached so we return as soon as the process is forked — the
 * deploy itself runs in the background and writes ~/.sciencedash/deploy.log
 * for debugging. The widget polls /api/deploy/status to learn the outcome.
 *
 * Auth: this route is gated by the proxy (Bearer or session cookie) like
 * any other API route — no extra check needed here.
 */
export async function POST() {
  if (!autoDeployEnabled()) {
    return NextResponse.json(
      { triggered: false, error: "auto-deploy is disabled" },
      { status: 403 },
    );
  }
  try {
    const child = spawn("bash", [deployScript()], {
      detached: true,
      stdio: "ignore",
      cwd: os.homedir(),
    });
    child.unref();
    return NextResponse.json({ triggered: true, pid: child.pid ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ triggered: false, error: msg }, { status: 500 });
  }
}
