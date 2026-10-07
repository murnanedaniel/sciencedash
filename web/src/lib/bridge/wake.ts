import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { resolveClaudePath } from "@/lib/ai/agentClient";

const execFileAsync = promisify(execFile);

export async function wakeSession(
  sessionId: string, message: string,
): Promise<{ ok: boolean; detail: string }> {
  if (process.env.SCIENCEDASH_BRIDGE_WAKE === "0") {
    return { ok: true, detail: "wake disabled" };
  }
  try {
    const claudePath = await resolveClaudePath();
    if (!claudePath) return { ok: false, detail: "claude executable not found" };
    const { stdout } = await execFileAsync(
      claudePath, ["-p", message, "--cloud", sessionId, "--output-format", "json"],
      { timeout: 120_000, cwd: tmpdir() },
    );
    const json = JSON.parse(stdout);
    return { ok: json?.ok === true, detail: stdout.trim() };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
