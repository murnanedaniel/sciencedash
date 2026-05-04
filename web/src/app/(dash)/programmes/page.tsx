import Link from "next/link";
import { prisma } from "@/lib/prisma";

/**
 * /programmes — list of all programmes plus their project rollup.
 *
 * Programmes are the layer above Project: a coordinated cluster sharing
 * a publication strategy (seed.md §5/§6). One project belongs to at
 * most one programme. Click into a programme for its detail page; click
 * "New programme" to create one.
 *
 * Mirrors /projects/page.tsx in shape but is much simpler — no tag
 * filters, no FOM filters; programmes are coarser.
 */
export default async function ProgrammesPage() {
  const programmes = await prisma.programme.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      projects: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
          narrativeReadiness: true,
        },
      },
    },
  });

  const unprogrammedCount = await prisma.project.count({
    where: { programmeId: null },
  });

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Programmes</h1>
        <p className="pageSub">
          Coordinated clusters of related projects. The layer above Project,
          orthogonal to tags.
        </p>
      </header>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <span className="muted small">
          {programmes.length} programme{programmes.length === 1 ? "" : "s"} ·{" "}
          {unprogrammedCount} unprogrammed project{unprogrammedCount === 1 ? "" : "s"}
        </span>
        <Link className="button" href="/programmes/new">
          New programme →
        </Link>
      </div>

      {programmes.length === 0 ? (
        <div className="card">
          <p className="muted">
            No programmes yet. <Link className="link" href="/programmes/new">Create one</Link>{" "}
            to roll up related projects under a shared thesis and FOM family.
          </p>
        </div>
      ) : (
        <div className="stack">
          {programmes.map((p) => {
            const active = p.projects.filter((q) => q.status === "active").length;
            const ready = p.projects.filter(
              (q) =>
                q.narrativeReadiness !== "none" &&
                q.narrativeReadiness !== "figures_exist",
            ).length;
            const lastTouch = p.projects
              .map((q) => q.updatedAt.getTime())
              .reduce((a, b) => Math.max(a, b), 0);
            return (
              <Link
                key={p.id}
                href={`/programmes/${p.id}`}
                className="kanbanCard"
                style={{ display: "block", textDecoration: "none" }}
              >
                <div
                  className="row"
                  style={{ justifyContent: "space-between", alignItems: "baseline" }}
                >
                  <h2 className="sectionTitle" style={{ margin: 0 }}>
                    {p.name}
                  </h2>
                  <span
                    className="pill"
                    style={{
                      background:
                        p.status === "parked" ? "var(--faint, #888)" : "var(--accent, #2a8c4a)",
                      color: "#fff",
                      fontSize: 11,
                    }}
                  >
                    {p.status}
                  </span>
                </div>
                {p.description ? (
                  <p
                    className="muted small"
                    style={{
                      marginTop: 6,
                      maxHeight: "2.4em",
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {p.description}
                  </p>
                ) : (
                  <p className="muted small" style={{ marginTop: 6, fontStyle: "italic" }}>
                    no thesis written yet
                  </p>
                )}
                <div className="muted small" style={{ marginTop: 8 }}>
                  {p.projects.length} project{p.projects.length === 1 ? "" : "s"}
                  {p.projects.length > 0
                    ? ` · ${active} active · ${ready} narrative-ready`
                    : ""}
                  {lastTouch
                    ? ` · last touch ${new Date(lastTouch).toLocaleDateString()}`
                    : ""}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
