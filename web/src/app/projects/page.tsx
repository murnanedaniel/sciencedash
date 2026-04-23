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
          <h1>ScienceDash</h1>
          <p className="muted">
            Projects with hypotheses, figures of merit, and next steps.
          </p>
        </div>
        <Link className="button" href="/projects/new">
          New project
        </Link>
      </header>

      <main className="stack">
        {projects.length === 0 ? (
          <div className="card">
            <p>No projects yet.</p>
            <p className="muted">
              Create your first “exploit / explore / system” project to start
              tracking toward paper-sized outputs.
            </p>
          </div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link key={p.id} className="card cardLink" href={`/projects/${p.id}`}>
                <div className="cardTitleRow">
                  <h2 className="cardTitle">{p.title}</h2>
                  <span className="pill">{p.type}</span>
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

