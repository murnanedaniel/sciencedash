import Link from "next/link";
import { ProjectStatus } from "@/generated/prisma/client";
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

/**
 * Deterministic hue for a tag name — so the same tag is always the same
 * colour. Restricted range feels quieter than raw 0–360.
 */
function tagHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Build a URL that toggles `tag` in the tags list, preserving other filters. */
function toggleTagHref(
  sp: Record<string, string | string[] | undefined>,
  tag: string,
  currentTags: string[],
): string {
  const next = currentTags.includes(tag)
    ? currentTags.filter((t) => t !== tag)
    : [...currentTags, tag];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "tags") continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val) params.set(k, String(val));
  }
  if (next.length) params.set("tags", next.join(","));
  const qs = params.toString();
  return qs ? `/projects?${qs}` : "/projects";
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const q = (asString(sp.q) ?? "").trim();
  const tagQuery = (asString(sp.tags) ?? "").trim();
  const tags = parseTags(tagQuery);

  const status = (asString(sp.status) ?? "").trim() as ProjectStatus | "";
  const fom = (asString(sp.fom) ?? "").trim();
  const timeline = (asString(sp.timeline) ?? "").trim();
  const next = (asString(sp.next) ?? "").trim();

  // AND semantics across tags: each selected tag becomes its own "must have"
  // clause. `colliderml` + `exploit` → projects with BOTH.
  const tagAnd = tags.map((name) => ({ tags: { some: { name } } }));

  const andClauses: object[] = [
    ...tagAnd,
    ...(q
      ? [
          {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { hypothesis: { contains: q, mode: "insensitive" as const } },
              { nextSteps: { contains: q, mode: "insensitive" as const } },
              { figuresOfMerit: { contains: q, mode: "insensitive" as const } },
              { timeline: { contains: q, mode: "insensitive" as const } },
            ],
          },
        ]
      : []),
    ...(fom
      ? [{ figuresOfMerit: { contains: fom, mode: "insensitive" as const } }]
      : []),
    ...(timeline
      ? [{ timeline: { contains: timeline, mode: "insensitive" as const } }]
      : []),
    ...(next
      ? [{ nextSteps: { contains: next, mode: "insensitive" as const } }]
      : []),
  ];

  const where = {
    ...(status ? { status } : {}),
    ...(andClauses.length ? { AND: andClauses } : {}),
  };

  const projects = await prisma.project.findMany({
    where,
    include: { tags: true },
    orderBy: [{ updatedAt: "desc" }],
  });

  // All tags + their project counts, for the right-rail filter.
  const allTags = await prisma.tag.findMany({
    include: { _count: { select: { projects: true } } },
  });
  const sortedTags = allTags
    .filter((t) => t._count.projects > 0)
    .sort((a, b) => {
      if (b._count.projects !== a._count.projects)
        return b._count.projects - a._count.projects;
      return a.name.localeCompare(b.name);
    });

  const selectedSet = new Set(tags);

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)" }}>Projects</h1>
          <p className="muted">
            Click tags in the right rail to stack filters (AND).
          </p>
        </div>
        <Link className="button" href="/projects/new">
          New project
        </Link>
      </header>

      <div className="projectsLayout">
        <main className="stack">
          <div className="card">
            <form className="stack" method="GET" action="/projects">
              {/* Preserve selected tags across form submits */}
              {tags.length ? (
                <input type="hidden" name="tags" value={tags.join(",")} />
              ) : null}
              <div
                className="row"
                style={{ alignItems: "flex-end", flexWrap: "wrap" }}
              >
                <div className="field" style={{ minWidth: 260, flex: "1 1 320px" }}>
                  <label htmlFor="q">Search</label>
                  <input
                    id="q"
                    name="q"
                    defaultValue={q}
                    placeholder="title / hypothesis / next steps / FOM / timeline"
                  />
                </div>
                <div className="field" style={{ minWidth: 160 }}>
                  <label htmlFor="status">Status</label>
                  <select
                    id="status"
                    name="status"
                    defaultValue={status || ""}
                  >
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
                <summary
                  className="muted small"
                  style={{ cursor: "pointer" }}
                >
                  Advanced slices
                </summary>
                <div
                  className="row"
                  style={{ marginTop: 10, flexWrap: "wrap" }}
                >
                  <div
                    className="field"
                    style={{ minWidth: 220, flex: "1 1 260px" }}
                  >
                    <label htmlFor="fom">Figure of merit contains</label>
                    <input
                      id="fom"
                      name="fom"
                      defaultValue={fom}
                      placeholder="e.g. AUC, resolution"
                    />
                  </div>
                  <div
                    className="field"
                    style={{ minWidth: 220, flex: "1 1 260px" }}
                  >
                    <label htmlFor="timeline">Timeline contains</label>
                    <input
                      id="timeline"
                      name="timeline"
                      defaultValue={timeline}
                      placeholder="e.g. May, Q3, week 2"
                    />
                  </div>
                  <div
                    className="field"
                    style={{ minWidth: 220, flex: "1 1 260px" }}
                  >
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

          {/* Active filter chips (removable) */}
          {tags.length > 0 ? (
            <div className="rowWrap">
              <span className="muted small" style={{ marginRight: 4 }}>
                Filtered by:
              </span>
              {tags.map((t) => {
                const hue = tagHue(t);
                return (
                  <Link
                    key={t}
                    href={toggleTagHref(sp, t, tags)}
                    className="tagFilterChip tagFilterChipOn"
                    style={
                      {
                        ["--tag-hue" as string]: String(hue),
                      } as React.CSSProperties
                    }
                    title={`Remove #${t}`}
                  >
                    <span className="tagDot" />
                    #{t}
                    <span className="tagRemove" aria-hidden="true">
                      ×
                    </span>
                  </Link>
                );
              })}
              <Link href="/projects" className="muted small link">
                clear all
              </Link>
            </div>
          ) : null}

          {projects.length === 0 ? (
            <div className="card">
              <div className="stackTight">
                <h2 className="cardTitle" style={{ marginBottom: 0 }}>
                  Nothing matches.
                </h2>
                <p className="muted">
                  Either adjust your filters or create a project that does.
                </p>
                <div className="row">
                  <Link className="button" href="/projects/new">
                    New project
                  </Link>
                  <Link className="button buttonSecondary" href="/projects">
                    Clear filters
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
                    <span className="pill pillMuted">{p.status}</span>
                  </div>
                  <div className="muted small">
                    Updated {formatUtc(p.updatedAt)} UTC
                  </div>
                  {p.tags.length ? (
                    <div className="rowWrap" style={{ marginTop: 10 }}>
                      {p.tags.slice(0, 6).map((t) => {
                        const hue = tagHue(t.name);
                        return (
                          <span
                            key={t.id}
                            className="tagFilterChip tagFilterChipOnCard"
                            style={
                              {
                                ["--tag-hue" as string]: String(hue),
                              } as React.CSSProperties
                            }
                          >
                            <span className="tagDot" />
                            {t.name}
                          </span>
                        );
                      })}
                      {p.tags.length > 6 ? (
                        <span className="pill pillMuted">
                          +{p.tags.length - 6}
                        </span>
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

        {/* Right rail: all tags, sorted by popularity, click to toggle. */}
        <aside className="tagRail">
          <div className="tagRailHead">
            <span>Tags</span>
            <span className="muted small">{sortedTags.length}</span>
          </div>
          <p className="muted small" style={{ marginBottom: 10, lineHeight: 1.5 }}>
            Click to filter. Multiple tags narrow with AND.
          </p>
          {sortedTags.length === 0 ? (
            <p className="muted small">No tags yet.</p>
          ) : (
            <div className="tagRailList">
              {sortedTags.map((t) => {
                const on = selectedSet.has(t.name);
                const hue = tagHue(t.name);
                return (
                  <Link
                    key={t.id}
                    href={toggleTagHref(sp, t.name, tags)}
                    className={`tagFilterChip${on ? " tagFilterChipOn" : ""}`}
                    style={
                      {
                        ["--tag-hue" as string]: String(hue),
                      } as React.CSSProperties
                    }
                    title={
                      on ? `Remove #${t.name}` : `Filter by #${t.name}`
                    }
                  >
                    <span className="tagDot" />
                    {t.name}
                    <span className="tagCount">{t._count.projects}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
