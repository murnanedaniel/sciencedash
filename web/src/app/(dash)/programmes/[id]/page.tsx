import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { InlineField } from "@/components/InlineField";
import {
  patchProgrammeField,
  setProgrammeStatusAction,
  deleteProgrammeAction,
} from "@/lib/server/programmeActions";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProgrammeDetailPage({ params }: PageProps) {
  const { id } = await params;
  const programme = await prisma.programme.findUnique({
    where: { id },
    include: {
      projects: {
        select: {
          id: true,
          title: true,
          status: true,
          narrativeReadiness: true,
          updatedAt: true,
          tags: { select: { name: true } },
        },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      },
    },
  });
  if (!programme) notFound();

  // Programme-scoped decision log: any decision whose subject is one of
  // the child projects. Mirrors what /portfolio shows globally, but
  // narrowed to this programme's children.
  const childIds = programme.projects.map((p) => p.id);
  const decisions = childIds.length
    ? await prisma.decision.findMany({
        where: {
          subjectType: "project",
          subjectId: { in: childIds },
        },
        orderBy: { at: "desc" },
        take: 10,
      })
    : [];
  const projectTitleById = new Map(programme.projects.map((p) => [p.id, p.title]));

  return (
    <div className="container">
      <header className="pageHead">
        <p className="muted small">
          <Link className="link" href="/programmes">
            ← Programmes
          </Link>
        </p>
        <h1 className="pageTitle">
          <InlineField
            value={programme.name}
            field="name"
            idForAction={programme.id}
            action={patchProgrammeField}
          />
        </h1>
        <p className="pageSub muted small">
          {programme.projects.length} project
          {programme.projects.length === 1 ? "" : "s"} · status:{" "}
          <span
            className="pill"
            style={{
              background:
                programme.status === "parked"
                  ? "var(--faint, #888)"
                  : "var(--accent, #2a8c4a)",
              color: "#fff",
              fontSize: 11,
              padding: "1px 8px",
            }}
          >
            {programme.status}
          </span>
        </p>
      </header>

      <div className="twoCol">
        <div className="stack">
          <div className="card">
            <h2 className="sectionTitle">Thesis</h2>
            <p className="muted small" style={{ marginBottom: 6 }}>
              What story is this programme trying to tell, across the child projects?
            </p>
            <InlineField
              value={programme.description}
              field="description"
              idForAction={programme.id}
              action={patchProgrammeField}
              placeholder="Programme thesis (markdown)…"
              multiline
            />
          </div>

          <div className="card">
            <h2 className="sectionTitle">Target venues</h2>
            <InlineField
              value={programme.targetVenues}
              field="targetVenues"
              idForAction={programme.id}
              action={patchProgrammeField}
              placeholder="JINST, Comput Phys Comm, NeurIPS…"
            />
          </div>

          <div className="card">
            <h2 className="sectionTitle">Figures of merit (programme-level)</h2>
            <p className="muted small" style={{ marginBottom: 6 }}>
              What counts as winning across the children?
            </p>
            <InlineField
              value={programme.figuresOfMerit}
              field="figuresOfMerit"
              idForAction={programme.id}
              action={patchProgrammeField}
              placeholder="Programme FOM family…"
              multiline
            />
          </div>

          <div className="card">
            <h2 className="sectionTitle">Projects</h2>
            {programme.projects.length === 0 ? (
              <p className="muted small">
                No projects attached yet. Open a project&apos;s Overview tab and use the
                Programme dropdown to attach it.
              </p>
            ) : (
              <table style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 4px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      Title
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "6px 4px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      Status
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "6px 4px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      Narrative
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "6px 4px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      Last touch
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {programme.projects.map((p) => (
                    <tr key={p.id}>
                      <td
                        style={{
                          padding: "6px 4px",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <Link className="link" href={`/projects/${p.id}`}>
                          {p.title}
                        </Link>
                        {p.tags.length > 0 ? (
                          <span
                            className="muted small"
                            style={{ marginLeft: 6, fontSize: 11 }}
                          >
                            {p.tags.map((t) => t.name).join(", ")}
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <span className="muted small">{p.status}</span>
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <span className="muted small">
                          {p.narrativeReadiness.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td
                        className="muted small"
                        style={{
                          textAlign: "right",
                          padding: "6px 4px",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {p.updatedAt.toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2 className="sectionTitle">Recent decisions</h2>
            {decisions.length === 0 ? (
              <p className="muted small">
                No decisions on this programme&apos;s projects yet.
              </p>
            ) : (
              <ul className="stack" style={{ listStyle: "none" }}>
                {decisions.map((d) => (
                  <li key={d.id} className="railItem">
                    <time>{d.at.toLocaleDateString()} · {d.kind.replace(/_/g, " ")}</time>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      <Link className="link" href={`/projects/${d.subjectId}`}>
                        {projectTitleById.get(d.subjectId) ?? "(project)"}
                      </Link>
                    </div>
                    {d.rationale ? (
                      <div style={{ marginTop: 4 }}>{d.rationale}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="rail">
          <div className="card">
            <h2 className="sectionTitle">State</h2>
            <p className="muted small" style={{ marginBottom: 6 }}>
              One-line status note (e.g. &quot;tracking 3 papers&quot;, &quot;blocked on X&quot;).
            </p>
            <InlineField
              value={programme.narrativeReadinessNote}
              field="narrativeReadinessNote"
              idForAction={programme.id}
              action={patchProgrammeField}
              placeholder="…"
            />
            <hr style={{ margin: "12px 0", border: 0, borderTop: "1px solid var(--border)" }} />
            <form action={setProgrammeStatusAction.bind(null, programme.id)}>
              <label className="field">
                <span className="muted small">Status</span>
                <select name="status" defaultValue={programme.status} style={{ fontSize: 13 }}>
                  <option value="active">active</option>
                  <option value="parked">parked</option>
                </select>
              </label>
              <button
                type="submit"
                className="button buttonSecondary small"
                style={{ marginTop: 8, padding: "2px 8px", fontSize: 12 }}
              >
                Save status
              </button>
            </form>
          </div>

          <div className="card danger">
            <h2 className="sectionTitle">Danger zone</h2>
            <p className="muted small" style={{ marginBottom: 8 }}>
              Deleting detaches all child projects (sets their{" "}
              <code>programmeId = null</code>); the projects themselves survive.
            </p>
            <form action={deleteProgrammeAction.bind(null, programme.id)}>
              <button className="button buttonDanger" type="submit">
                Delete programme
              </button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}
