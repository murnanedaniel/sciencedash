import Link from "next/link";
import { ProjectStatus, ProjectType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/tags";

function formatUtc(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(date);
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const q = (asString(sp.q) ?? "").trim();
  const tagQuery = (asString(sp.tags) ?? "").trim();
  const tags = parseTags(tagQuery);

  const type = (asString(sp.type) ?? "").trim() as ProjectType | "";
  const status = (asString(sp.status) ?? "").trim() as ProjectStatus | "";
  const fom = (asString(sp.fom) ?? "").trim();
  const timeline = (asString(sp.timeline) ?? "").trim();
  const next = (asString(sp.next) ?? "").trim();

  const where = {
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(tags.length
      ? {
          tags: {
            some: { name: { in: tags } },
          },
        }
      : {}),
    ...(q || fom || timeline || next
      ? {
          AND: [
            ...(q
              ? [
                  {
                    OR: [
                      { title: { contains: q, mode: "insensitive" as const } },
                      {
                        hypothesis: {
                          contains: q,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        nextSteps: { contains: q, mode: "insensitive" as const },
                      },
                      {
                        figuresOfMerit: {
                          contains: q,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        timeline: { contains: q, mode: "insensitive" as const },
                      },
                    ],
                  },
                ]
              : []),
            ...(fom
              ? [
                  {
                    figuresOfMerit: {
                      contains: fom,
                      mode: "insensitive" as const,
                    },
                  },
                ]
              : []),
            ...(timeline
              ? [
                  {
                    timeline: {
                      contains: timeline,
                      mode: "insensitive" as const,
                    },
                  },
                ]
              : []),
            ...(next
              ? [
                  {
                    nextSteps: {
                      contains: next,
                      mode: "insensitive" as const,
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
  };

  const projects = await prisma.project.findMany({
    where,
    include: { tags: true },
    orderBy: [{ updatedAt: "desc" }],
  });

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)" }}>Projects</h1>
          <p className="muted">Exploit, explore, system-build. Keep it paper-sized.</p>
        </div>
        <Link className="button" href="/projects/new">
          New project
        </Link>
      </header>

      <main className="stack">
        <div className="card">
          <form className="stack" method="GET" action="/projects">
            <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ minWidth: 260, flex: "1 1 320px" }}>
                <label htmlFor="q">Search</label>
                <input
                  id="q"
                  name="q"
                  defaultValue={q}
                  placeholder="title / hypothesis / next steps / FOM / timeline"
                />
              </div>
              <div className="field" style={{ minWidth: 220, flex: "1 1 240px" }}>
                <label htmlFor="tags">Tags</label>
                <input
                  id="tags"
                  name="tags"
                  defaultValue={tagQuery}
                  placeholder="tracking, hl-lhc, ..."
                />
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label htmlFor="type">Type</label>
                <select id="type" name="type" defaultValue={type || ""}>
                  <option value="">Any</option>
                  {Object.values(ProjectType).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label htmlFor="status">Status</label>
                <select id="status" name="status" defaultValue={status || ""}>
                  <option value="">Any</option>
                  {Object.values(ProjectStatus).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <button className="button" type="submit">
                  Apply
                </button>
                <Link className="button buttonSecondary" href="/projects">
                  Clear
                </Link>
              </div>
            </div>

            <details>
              <summary className="muted small" style={{ cursor: "pointer" }}>
                Advanced slices
              </summary>
              <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <div className="field" style={{ minWidth: 220, flex: "1 1 260px" }}>
                  <label htmlFor="fom">Figure of merit contains</label>
                  <input id="fom" name="fom" defaultValue={fom} placeholder="e.g. AUC, resolution" />
                </div>
                <div className="field" style={{ minWidth: 220, flex: "1 1 260px" }}>
                  <label htmlFor="timeline">Timeline contains</label>
                  <input
                    id="timeline"
                    name="timeline"
                    defaultValue={timeline}
                    placeholder="e.g. May, Q3, week 2"
                  />
                </div>
                <div className="field" style={{ minWidth: 220, flex: "1 1 260px" }}>
                  <label htmlFor="next">Next steps contains</label>
                  <input
                    id="next"
                    name="next"
                    defaultValue={next}
                    placeholder="e.g. run ablation, write intro"
                  />
                </div>
              </div>
            </details>
          </form>
        </div>

        {projects.length === 0 ? (
          <div className="card">
            <div className="stackTight">
              <h2 className="cardTitle" style={{ marginBottom: 0 }}>
                Start a paper pipeline.
              </h2>
              <p className="muted">
                Create a first project with a hypothesis, a metric, and a next step.
              </p>
              <div className="row">
                <Link className="button" href="/projects/new">
                  Create your first project
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link
                key={p.id}
                className="card cardLink"
                href={`/projects/${p.id}`}
              >
                <div className="cardTitleRow">
                  <h2 className="cardTitle">{p.title}</h2>
                  <span className="pill">
                    <span style={{ color: "var(--accent)" }}>{p.type}</span>
                  </span>
                  <span className="pill pillMuted">{p.status}</span>
                </div>
                <div className="muted small">
                  Updated {formatUtc(p.updatedAt)} UTC
                </div>
                {p.tags.length ? (
                  <div className="rowWrap" style={{ marginTop: 10 }}>
                    {p.tags.slice(0, 6).map((t) => (
                      <span key={t.id} className="pill">
                        #{t.name}
                      </span>
                    ))}
                    {p.tags.length > 6 ? (
                      <span className="pill pillMuted">+{p.tags.length - 6}</span>
                    ) : null}
                  </div>
                ) : null}
                {p.nextSteps ? (
                  <p className="preview">{p.nextSteps}</p>
                ) : (
                  <p className="muted preview">No next steps yet.</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

