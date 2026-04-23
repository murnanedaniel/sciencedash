import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
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
                  Updated {p.updatedAt.toLocaleString()}
                </div>
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

