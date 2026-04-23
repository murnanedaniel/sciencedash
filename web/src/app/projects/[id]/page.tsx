import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

type Props = {
  params: Promise<{ id: string }>;
};

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

async function deleteProject(id: string) {
  "use server";
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
  redirect("/projects");
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  return (
    <div className="container">
      <header className="header">
        <div className="stackTight">
          <h1 style={{ fontFamily: "var(--font-display)" }}>{project.title}</h1>
          <div className="rowWrap">
            <span className="pill">
              <span style={{ color: "var(--accent)" }}>{project.type}</span>
            </span>
            <span className="pill pillMuted">{project.status}</span>
            <span className="muted small">
              Updated {formatUtc(project.updatedAt)} UTC
            </span>
          </div>
        </div>
        <div className="row">
          <Link className="button buttonSecondary" href="/projects">
            Back
          </Link>
          <Link className="button" href={`/projects/${project.id}/edit`}>
            Edit
          </Link>
        </div>
      </header>

      <main className="stack">
        {project.githubRepoUrl ? (
          <div className="card">
            <div className="muted small">GitHub repo</div>
            <a className="link" href={project.githubRepoUrl} target="_blank" rel="noreferrer">
              {project.githubRepoUrl}
            </a>
          </div>
        ) : null}

        <div className="card">
          <h2 className="sectionTitle">Hypothesis</h2>
          <p className={project.hypothesis ? "" : "muted"}>
            {project.hypothesis ?? "—"}
          </p>
        </div>

        <div className="card">
          <h2 className="sectionTitle">Figures of merit</h2>
          <p className={project.figuresOfMerit ? "" : "muted"}>
            {project.figuresOfMerit ?? "—"}
          </p>
        </div>

        <div className="card">
          <h2 className="sectionTitle">Timeline</h2>
          <p className={project.timeline ? "" : "muted"}>{project.timeline ?? "—"}</p>
        </div>

        <div className="card">
          <h2 className="sectionTitle">Next steps</h2>
          <p className={project.nextSteps ? "" : "muted"}>{project.nextSteps ?? "—"}</p>
        </div>

        <div className="card">
          <h2 className="sectionTitle">Narrative readiness</h2>
          <p className={project.narrativeReadiness ? "" : "muted"}>
            {project.narrativeReadiness ?? "—"}
          </p>
        </div>

        <div className="card">
          <h2 className="sectionTitle">Blockers</h2>
          <p className={project.blockers ? "" : "muted"}>{project.blockers ?? "—"}</p>
        </div>

        <div className="card danger">
          <h2 className="sectionTitle">Danger zone</h2>
          <form action={deleteProject.bind(null, project.id)}>
            <button className="button buttonDanger" type="submit">
              Delete project
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

