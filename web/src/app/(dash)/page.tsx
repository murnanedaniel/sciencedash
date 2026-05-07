import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { daysAgoLabel, relativeDays, formatUtc } from "@/lib/format";
import { createCheckIn, applyProposedPatch } from "@/lib/server/checkInActions";
import { DigestPanel } from "@/components/DigestPanel";
import { MarkdownBody } from "@/components/MarkdownBody";

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
      const lastTouch = Math.max(p.updatedAt.getTime(), lastRunEnd, lastDecision);
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

  const aiCheckIns = await prisma.checkIn.findMany({
    where: { source: "ai" },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { project: { select: { id: true, title: true } } },
  });

  const recentCheckIns = await prisma.checkIn.findMany({
    where: { scope: "project" },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { project: { select: { id: true, title: true } } },
  });

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Today</h1>
        <p className="pageSub">First-hour ritual. Small moves, logged.</p>
      </header>

      <DigestPanel />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginBottom: 18 }}>
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

        <Zone title="Pending AI reviews">
          {aiCheckIns.length === 0 ? (
            <Empty>None queued.</Empty>
          ) : (
            <TodayCard
              href={`/projects/${aiCheckIns[0]!.project?.id}`}
              kicker={daysAgoLabel(aiCheckIns[0]!.createdAt)}
              title={aiCheckIns[0]!.project?.title ?? "(unlinked)"}
              rest={aiCheckIns.length - 1}
            />
          )}
        </Zone>
      </div>

      <div className="twoCol">
        <div className="stack">
          <div className="card">
            <h2 className="sectionTitle">Portfolio check-in</h2>
            <form action={createCheckIn.bind(null, { scope: "portfolio" as const, scopeId: null })} className="stackTight">
              <textarea name="bodyMd" rows={3} placeholder="what's the shape of the week so far" />
              <button type="submit" className="button" style={{ width: "fit-content" }}>Log</button>
            </form>
          </div>

          {aiCheckIns.length > 0 ? (
            <div className="card">
              <h2 className="sectionTitle">AI critical reviews</h2>
              <div className="stack">
                {aiCheckIns.map((c) => (
                  <AICheckInRow key={c.id} checkIn={c} />
                ))}
              </div>
            </div>
          ) : null}

          {recentCheckIns.length > 0 ? (
            <div className="card">
              <h2 className="sectionTitle">Recent check-ins</h2>
              <ul className="stack" style={{ listStyle: "none" }}>
                {recentCheckIns.map((c) => (
                  <li key={c.id} className="railItem">
                    <time>
                      {formatUtc(c.createdAt)} · {c.project?.title ?? "(portfolio)"}
                    </time>
                    <div style={{ marginTop: 4 }}>
                      <MarkdownBody source={c.bodyMd} maxLines={4} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="rail">
          <div className="railItem">
            <time>Quick add</time>
            Capture an idea without friction.
            <div style={{ marginTop: 8 }}>
              <Link className="button" href="/projects/new">
                New project →
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Zone({ title, children }: { title: string; children: React.ReactNode }) {
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

type AiCheckIn = Awaited<ReturnType<typeof prisma.checkIn.findMany>>[number] & {
  project: { id: string; title: string } | null;
};

function AICheckInRow({ checkIn: c }: { checkIn: AiCheckIn }) {
  let patches: Array<{ path: string; value: string; applied?: boolean }> = [];
  let diagnosis = "";
  let recommendation = "";
  let rationale = "";
  try {
    const parsed = c.proposedPatchJson ? JSON.parse(c.proposedPatchJson) : null;
    if (parsed) {
      patches = parsed.proposedPatches ?? [];
      diagnosis = parsed.diagnosis ?? "";
      recommendation = parsed.recommendation ?? "";
      rationale = parsed.rationale ?? "";
    }
  } catch {
    /* fall through */
  }

  return (
    <div className="railItem">
      <time>
        {daysAgoLabel(c.createdAt)} · {c.project?.title ?? "(project)"} · AI
      </time>
      {diagnosis ? (
        <div style={{ marginTop: 4 }}>
          <strong>Diagnosis:</strong>{" "}
          <MarkdownBody source={diagnosis} maxLines={3} className="mdInline" />
        </div>
      ) : null}
      {recommendation ? (
        <div style={{ marginTop: 4 }}>
          <strong>Recommendation:</strong>{" "}
          <MarkdownBody source={recommendation} maxLines={3} className="mdInline" />
        </div>
      ) : null}
      {c.bodyMd ? (
        <div style={{ marginTop: 6 }}>
          <MarkdownBody source={c.bodyMd} maxLines={4} />
        </div>
      ) : null}
      {rationale ? (
        <div className="muted small" style={{ marginTop: 4 }}>
          <MarkdownBody source={rationale} maxLines={3} className="mdInline" />
        </div>
      ) : null}
      {patches.length ? (
        <div style={{ marginTop: 8 }}>
          <div className="muted small">Proposed patches</div>
          <ul className="stackTight" style={{ listStyle: "none", marginTop: 4 }}>
            {patches.map((p, i) => (
              <li key={i} className="row" style={{ gap: 8, fontSize: 13 }}>
                <code style={{ fontFamily: "var(--font-geist-mono)" }}>{p.path}</code>
                <span className="muted">←</span>
                <span style={{ flex: 1 }}>{String(p.value).slice(0, 240)}</span>
                {p.applied ? (
                  <span className="pill">applied</span>
                ) : (
                  <form action={applyProposedPatch.bind(null, c.id, i)}>
                    <button
                      type="submit"
                      className="button"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                    >
                      Accept
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
