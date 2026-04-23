import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { daysAgoLabel, relativeDays } from "@/lib/format";

export default async function TodayPage() {
  const projects = await prisma.project.findMany({
    include: {
      hypotheses: { include: { runs: { orderBy: { endedAt: "desc" }, take: 1 } } },
      decisions: { orderBy: { at: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const stalled = projects
    .filter((p) => p.status === "active")
    .map((p) => {
      const lastRunEnd = p.hypotheses
        .flatMap((h) => h.runs)
        .map((r) => r.endedAt?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);
      const lastDecision = p.decisions[0]?.at.getTime() ?? 0;
      const lastTouch = Math.max(
        p.updatedAt.getTime(),
        lastRunEnd,
        lastDecision,
      );
      return { p, lastTouch };
    })
    .filter((x) => relativeDays(new Date(x.lastTouch)) >= 14)
    .sort((a, b) => a.lastTouch - b.lastTouch);

  const narrativeReady = projects.filter(
    (p) =>
      p.narrativeReadiness !== "none" &&
      p.narrativeReadiness !== "figures_exist" &&
      p.status !== "shipped" &&
      p.status !== "parked",
  );

  const recentRuns = await prisma.run.findMany({
    where: { endedAt: { not: null } },
    orderBy: { endedAt: "desc" },
    take: 5,
    include: {
      hypothesis: { include: { project: { select: { id: true, title: true } } } },
    },
  });

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Today</h1>
        <p className="pageSub">First-hour ritual. Small moves, logged.</p>
      </header>

      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
      >
        <Zone title="Stalled">
          {stalled.length === 0 ? (
            <Empty>No stalled active projects.</Empty>
          ) : (
            <TodayCard
              href={`/projects/${stalled[0]!.p.id}`}
              kicker={daysAgoLabel(new Date(stalled[0]!.lastTouch))}
              title={stalled[0]!.p.title}
              rest={stalled.length - 1}
              restHref="/projects?status=active"
            />
          )}
        </Zone>

        <Zone title="Narrative-ready">
          {narrativeReady.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <TodayCard
              href={`/projects/${narrativeReady[0]!.id}`}
              kicker={narrativeReady[0]!.narrativeReadiness.replace("_", " ")}
              title={narrativeReady[0]!.title}
              rest={narrativeReady.length - 1}
              restHref="/projects"
            />
          )}
        </Zone>

        <Zone title="Recent runs">
          {recentRuns.length === 0 ? (
            <Empty>No completed runs yet.</Empty>
          ) : (
            <TodayCard
              href={`/projects/${recentRuns[0]!.hypothesis.project.id}`}
              kicker={daysAgoLabel(recentRuns[0]!.endedAt!)}
              title={`${recentRuns[0]!.name} · ${recentRuns[0]!.hypothesis.project.title}`}
              rest={recentRuns.length - 1}
              restHref="/runs"
            />
          )}
        </Zone>

        <Zone title="Quick add">
          <p className="muted small" style={{ marginBottom: 10 }}>
            Capture an idea without friction.
          </p>
          <Link className="button" href="/projects/new">
            New project →
          </Link>
        </Zone>
      </div>
    </div>
  );
}

function Zone({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <h2 className="sectionTitle">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="muted small" style={{ padding: "4px 0" }}>
      {children}
    </p>
  );
}

function TodayCard({
  href,
  kicker,
  title,
  rest,
  restHref,
}: {
  href: string;
  kicker: string;
  title: string;
  rest: number;
  restHref?: string;
}) {
  return (
    <div className="stackTight">
      <Link href={href} className="kanbanCard" style={{ marginBottom: 0 }}>
        <div className="muted small" style={{ marginBottom: 4 }}>
          {kicker}
        </div>
        <div>{title}</div>
      </Link>
      {rest > 0 && restHref ? (
        <Link href={restHref} className="muted small">
          +{rest} more →
        </Link>
      ) : null}
    </div>
  );
}
