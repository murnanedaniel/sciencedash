import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatUtc } from "@/lib/format";

export default async function RunsPage() {
  const runs = await prisma.run.findMany({
    orderBy: { endedAt: "desc" },
    take: 200,
    include: {
      metrics: { include: { definition: true } },
      hypothesis: { include: { project: { select: { id: true, title: true } } } },
    },
  });

  // Collect all metric names across runs for column headers.
  const metricNames = Array.from(
    new Set(runs.flatMap((r) => r.metrics.map((m) => m.definition.name))),
  );

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Runs</h1>
        <p className="pageSub">Most recent across all hypotheses.</p>
      </header>

      {runs.length === 0 ? (
        <div className="card muted">No runs yet. Log one under any project&apos;s Hypotheses &amp; Runs tab.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="metricTable">
            <thead>
              <tr>
                <th>Ended</th>
                <th>Project</th>
                <th>Hypothesis</th>
                <th>Run</th>
                <th className="num">GPU-h</th>
                {metricNames.map((n) => (
                  <th key={n} className="num">{n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.endedAt ? formatUtc(r.endedAt) : "—"}</td>
                  <td>
                    <Link className="link" href={`/projects/${r.hypothesis.project.id}`}>
                      {r.hypothesis.project.title}
                    </Link>
                  </td>
                  <td>{r.hypothesis.title}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.computeGpuHours.toFixed(1)}</td>
                  {metricNames.map((n) => {
                    const m = r.metrics.find((x) => x.definition.name === n);
                    return (
                      <td key={n} className="num">
                        {m ? m.value : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
