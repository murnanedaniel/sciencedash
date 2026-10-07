import { prisma } from "@/lib/prisma";
import { deriveWorkhorseState } from "@/lib/bridge/workhorseState";
import { stopWorkhorseAction, resumeWorkhorseAction } from "@/lib/server/agentMessageActions";
import { RemoveWorkhorseButton } from "@/components/RemoveWorkhorseButton";

export async function WorkhorsesPanel({ projectId }: { projectId: string; projectTitle: string }) {
  const [workhorses, bridges] = await Promise.all([
    prisma.workhorse.findMany({ where: { projectId }, orderBy: { bridgeName: "asc" } }),
    prisma.bridge.findMany(),
  ]);
  const byName = new Map(bridges.map((b) => [b.name, { ...b, liveSessions: [] }]));
  const now = new Date();
  return (
    <div className="card">
      <h2 className="sectionTitle">Workhorses</h2>
      <div className="stack" style={{ gap: 8 }}>
        {workhorses.map((w) => (
          <div key={w.id}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <strong>{w.bridgeName}</strong>
              <a className="link" href={`https://claude.ai/code/${encodeURIComponent(w.rcSessionId)}`} target="_blank" rel="noreferrer">Open session</a>
              <span className="pill">{deriveWorkhorseState(w.rcState, byName.get(w.bridgeName), now)}</span>
              <form action={w.rcState === "stopped" ? resumeWorkhorseAction : stopWorkhorseAction}>
                <input type="hidden" name="workhorseId" value={w.id} />
                <button className="button buttonSecondary small" type="submit">{w.rcState === "stopped" ? "Resume" : "Stop"}</button>
              </form>
              <RemoveWorkhorseButton workhorseId={w.id} bridgeName={w.bridgeName} />
            </div>
            <p className="muted small">
              Last wake: {w.lastWakeAt?.toISOString() ?? "never"} · Last tick: {w.lastTickAt?.toISOString() ?? "never"}
              {w.repo ? ` · Repo: ${w.repo}` : ""}
            </p>
          </div>
        ))}
      </div>
      <p className="muted small">To add a workhorse: start a session on the <code>perlmutter</code> bridge and call <code>register_rc_workhorse</code>.</p>
      <p className="muted small">Stop pauses automated wakes and ticks. Remove unregisters the session.</p>
    </div>
  );
}
