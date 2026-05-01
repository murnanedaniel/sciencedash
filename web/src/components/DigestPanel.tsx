/**
 * Digest panel — top of /today.
 *
 * Shows the highest-priority unread AgentMessages across all active
 * projects. The aggregation is the point: per-project brains have
 * already triaged what's worth surfacing; /today's job is to put a
 * cross-project view in front of you so you can decide what to act on.
 *
 * Severity sort: blocker > decision > suggestion > info. Within a
 * severity tier, newest first. Cap at TOP_N items so /today stays a
 * quick scan, not a feed.
 */

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { daysAgoLabel } from "@/lib/format";
import { GlobalHeartbeatButton } from "@/components/GlobalHeartbeatButton";

const SEVERITY_RANK: Record<string, number> = {
  blocker: 4,
  decision: 3,
  suggestion: 2,
  info: 1,
};
const TOP_N = 5;

export async function DigestPanel() {
  // Pull a generous prefix of recent unread messages, then re-sort in
  // application code (Prisma's order-by enum-strings is lexicographic).
  const recent = await prisma.agentMessage.findMany({
    where: {
      readAt: null,
      project: { status: { in: ["active", "blocked"] } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { project: { select: { id: true, title: true } } },
  });

  const sorted = [...recent].sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const top = sorted.slice(0, TOP_N);

  if (top.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <h2 className="sectionTitle" style={{ marginTop: 0, marginBottom: 0 }}>
            Digest{" "}
            <span className="muted small">(brains across active projects)</span>
          </h2>
          <GlobalHeartbeatButton />
        </div>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Nothing for your attention right now. Run a brain heartbeat on a
          project from its Overview tab to start surfacing items, or click
          "Run brains" above to fire a heartbeat across all active projects.
        </p>
      </div>
    );
  }

  const remaining = sorted.length - top.length;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <h2 className="sectionTitle" style={{ marginTop: 0, marginBottom: 0 }}>
          Digest{" "}
          <span className="muted small">
            ({top.length}
            {remaining > 0 ? ` of ${sorted.length}` : ""} unread across active projects)
          </span>
        </h2>
        <GlobalHeartbeatButton />
      </div>
      <div className="stack" style={{ marginTop: 10, gap: 6 }}>
        {top.map((m) => {
          const sevColor =
            m.severity === "blocker"
              ? "var(--red, #c0322a)"
              : m.severity === "decision"
                ? "var(--accent, #6a4cd6)"
                : m.severity === "suggestion"
                  ? "var(--accent2, #b08a3a)"
                  : "var(--muted, #888)";
          return (
            <Link
              key={m.id}
              href={`/projects/${m.projectId}?tab=feed`}
              className="row"
              style={{
                gap: 10,
                alignItems: "flex-start",
                textDecoration: "none",
                color: "inherit",
                padding: "8px 10px",
                border: `1px solid var(--border, #e0e0e0)`,
                borderLeft: `3px solid ${sevColor}`,
                borderRadius: 6,
              }}
            >
              <span
                className="pill"
                style={{ background: sevColor, color: "#fff", fontSize: 10, alignSelf: "flex-start" }}
              >
                {m.severity}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                  {firstLine(m.body)}
                </div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  {m.project.title} · {m.source} · {daysAgoLabel(m.createdAt)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/)[0]?.trim() ?? "";
  return line.length > 200 ? line.slice(0, 200) + "…" : line;
}
