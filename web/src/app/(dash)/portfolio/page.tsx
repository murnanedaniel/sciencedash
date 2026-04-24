import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { daysAgoLabel, formatUtc, relativeDays } from "@/lib/format";
import { ProjectStatus, PaperStatus } from "@/generated/prisma/client";
import { RunAiAuditButton } from "@/components/RunAiAuditButton";

const KIND_TAGS = ["exploit", "explore", "system"] as const;
type KindTag = (typeof KIND_TAGS)[number];

export default async function PortfolioPage() {
  const projects = await prisma.project.findMany({
    include: {
      tags: { select: { name: true } },
      hypotheses: { include: { runs: { orderBy: { endedAt: "desc" }, take: 1 } } },
      decisions: { orderBy: { at: "desc" }, take: 1 },
      checkIns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const papers = await prisma.paper.findMany({});
  const decisions = await prisma.decision.findMany({
    orderBy: { at: "desc" },
    take: 30,
    include: { project: { select: { title: true, id: true } } },
  });

  // Status counts
  const statusCounts = new Map<string, number>();
  for (const p of projects) {
    statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);
  }

  // Stalled active
  const stalledCount = projects.filter((p) => {
    if (p.status !== "active") return false;
    const lastRun = p.hypotheses
      .flatMap((h) => h.runs)
      .map((r) => r.endedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const last = Math.max(
      p.updatedAt.getTime(),
      lastRun,
      p.decisions[0]?.at.getTime() ?? 0,
      p.checkIns[0]?.createdAt.getTime() ?? 0,
    );
    return relativeDays(new Date(last)) >= 14;
  }).length;

  // Narrative ready
  const narrativeReady = projects.filter(
    (p) =>
      p.narrativeReadiness !== "none" &&
      p.narrativeReadiness !== "figures_exist" &&
      p.status !== "shipped" &&
      p.status !== "parked",
  ).length;

  // Publication velocity — papers by quarter
  const velocity = new Map<string, number>();
  for (const pa of papers) {
    if (pa.status === "skeleton") continue;
    const d = new Date(pa.updatedAt);
    const q = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    velocity.set(q, (velocity.get(q) ?? 0) + 1);
  }
  const velocityRows = Array.from(velocity.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  // Exploit / explore / system balance — from the #exploit / #explore / #system
  // tags (if the user uses them). Projects tagged with none of them count as
  // "untagged" and show in the balance as a neutral slice.
  const balance: Record<KindTag | "untagged", number> = {
    exploit: 0,
    explore: 0,
    system: 0,
    untagged: 0,
  };
  for (const p of projects) {
    const kinds = (p.tags as { name: string }[])
      .map((t) => t.name)
      .filter((n): n is KindTag => (KIND_TAGS as readonly string[]).includes(n));
    if (kinds.length === 0) balance.untagged += 1;
    else for (const k of kinds) balance[k] += 1;
  }
  const balanceTotal =
    balance.exploit + balance.explore + balance.system + balance.untagged || 1;

  return (
    <div className="container">
      <header className="pageHead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="pageTitle">Portfolio</h1>
          <p className="pageSub">Outer-loop (§11) view of the whole program.</p>
        </div>
        <RunAiAuditButton />
      </header>

      <div className="stack">
        {/* Summary tiles */}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Tile label="Active projects" value={projects.filter((p) => p.status === "active").length} />
          <Tile label="Stalled ≥ 14 days" value={stalledCount} emphasis={stalledCount > 0} />
          <Tile label="Narrative-ready" value={narrativeReady} />
          <Tile label="Papers in flight" value={papers.filter((p) => p.status !== "published").length} />
          <Tile label="Papers published" value={papers.filter((p) => p.status === "published").length} />
        </div>

        {/* Status summary */}
        <div className="card">
          <h2 className="sectionTitle">Projects by status</h2>
          <div
            className="heatmap"
            style={{
              gridTemplateColumns: `repeat(${Object.values(ProjectStatus).length}, minmax(0, 1fr))`,
            }}
          >
            {Object.values(ProjectStatus).map((s) => {
              const c = statusCounts.get(s) ?? 0;
              return (
                <Link
                  key={s}
                  href={`/projects?status=${s}`}
                  className="cell"
                  style={{
                    textDecoration: "none",
                    opacity: c === 0 ? 0.35 : 1,
                  }}
                  title={s}
                >
                  <strong>{c}</strong>
                  <span>{s}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Kind balance (driven by #exploit/#explore/#system tags) */}
        <div className="card">
          <h2 className="sectionTitle">Kind balance (from tags)</h2>
          <div className="row" style={{ gap: 6 }}>
            <BalanceBar kind="exploit" v={balance.exploit / balanceTotal} />
            <BalanceBar kind="explore" v={balance.explore / balanceTotal} />
            <BalanceBar kind="system" v={balance.system / balanceTotal} />
            {balance.untagged > 0 ? (
              <BalanceBar kind="untagged" v={balance.untagged / balanceTotal} />
            ) : null}
          </div>
          <div className="row" style={{ gap: 18, marginTop: 8, flexWrap: "wrap" }}>
            <Link className="muted small link" href="/projects?tags=exploit">
              #exploit · {balance.exploit}
            </Link>
            <Link className="muted small link" href="/projects?tags=explore">
              #explore · {balance.explore}
            </Link>
            <Link className="muted small link" href="/projects?tags=system">
              #system · {balance.system}
            </Link>
            {balance.untagged > 0 ? (
              <span className="muted small">
                no kind tag · {balance.untagged}
              </span>
            ) : null}
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Driven entirely by tags. Tag a project <code>#exploit</code>,{" "}
            <code>#explore</code>, or <code>#system</code> to include it here.
          </p>
        </div>

        {/* Publication velocity */}
        <div className="card">
          <h2 className="sectionTitle">Publication velocity</h2>
          {velocityRows.length === 0 ? (
            <p className="muted">Nothing shipped yet.</p>
          ) : (
            <table className="metricTable">
              <thead>
                <tr>
                  <th>Quarter</th>
                  <th className="num">Papers</th>
                </tr>
              </thead>
              <tbody>
                {velocityRows.map(([q, n]) => (
                  <tr key={q}>
                    <td>{q}</td>
                    <td className="num">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Papers kanban glance */}
        <div className="card">
          <h2 className="sectionTitle">Papers pipeline</h2>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {Object.values(PaperStatus).map((s) => (
              <div key={s} className="railItem" style={{ flex: "1 1 140px" }}>
                <time>{s}</time>
                <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 20 }}>
                  {papers.filter((p) => p.status === s).length}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Decision log */}
        <div className="card">
          <h2 className="sectionTitle">Decision log</h2>
          {decisions.length === 0 ? (
            <p className="muted">No decisions recorded yet.</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none" }}>
              {decisions.map((d) => (
                <li key={d.id} className="railItem">
                  <time>{formatUtc(d.at)} · {d.kind.replace("_", " ")}</time>
                  {d.project ? (
                    <>
                      <Link className="link" href={`/projects/${d.project.id}`}>
                        {d.project.title}
                      </Link>
                      {" "}
                    </>
                  ) : null}
                  {d.rationale ?? ""}
                  <span className="muted small"> · {daysAgoLabel(d.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div className="muted small" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: 40,
          fontVariantNumeric: "tabular-nums",
          color: emphasis ? "var(--accent2)" : "var(--ink)",
          marginTop: 6,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BalanceBar({
  kind,
  v,
}: {
  kind: "exploit" | "explore" | "system" | "untagged";
  v: number;
}) {
  const label = kind;
  const bg =
    kind === "exploit"
      ? "var(--accent)"
      : kind === "explore"
        ? "var(--accent2)"
        : kind === "system"
          ? "var(--muted)"
          : "var(--faint)";
  return (
    <div
      style={{
        flex: Math.max(v, 0.02),
        background: `color-mix(in oklab, ${bg} 40%, transparent)`,
        border: "1px solid var(--border)",
        borderRadius: 999,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink)",
        fontSize: 12,
      }}
    >
      {label} · {(v * 100).toFixed(0)}%
    </div>
  );
}
