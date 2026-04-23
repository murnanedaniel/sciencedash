import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProjectStatus, ProjectType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Props = {
  params: Promise<{ id: string }>;
};

async function updateProject(id: string, formData: FormData) {
  "use server";

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim() as ProjectType;
  const status = String(formData.get("status") ?? "").trim() as ProjectStatus;

  const hypothesis = String(formData.get("hypothesis") ?? "").trim() || null;
  const figuresOfMerit = String(formData.get("figuresOfMerit") ?? "").trim() || null;
  const timeline = String(formData.get("timeline") ?? "").trim() || null;
  const nextSteps = String(formData.get("nextSteps") ?? "").trim() || null;
  const githubRepoUrl = String(formData.get("githubRepoUrl") ?? "").trim() || null;
  const narrativeReadiness =
    String(formData.get("narrativeReadiness") ?? "").trim() || null;
  const blockers = String(formData.get("blockers") ?? "").trim() || null;

  if (!title) {
    throw new Error("Title is required.");
  }

  await prisma.project.update({
    where: { id },
    data: {
      title,
      type,
      status,
      hypothesis,
      figuresOfMerit,
      timeline,
      nextSteps,
      githubRepoUrl,
      narrativeReadiness,
      blockers,
    },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

export default async function EditProjectPage({ params }: Props) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)" }}>Edit project</h1>
          <p className="muted">{project.title}</p>
        </div>
        <div className="row">
          <Link className="button buttonSecondary" href={`/projects/${project.id}`}>
            Back
          </Link>
        </div>
      </header>

      <main className="card">
        <form className="stack" action={async (fd) => updateProject(project.id, fd)}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" defaultValue={project.title} required />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" name="type" defaultValue={project.type}>
                {Object.values(ProjectType).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={project.status}>
                {Object.values(ProjectStatus).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="hypothesis">Hypothesis</label>
            <textarea
              id="hypothesis"
              name="hypothesis"
              rows={3}
              defaultValue={project.hypothesis ?? ""}
            />
          </div>

          <div className="field">
            <label htmlFor="figuresOfMerit">Figures of merit</label>
            <textarea
              id="figuresOfMerit"
              name="figuresOfMerit"
              rows={3}
              defaultValue={project.figuresOfMerit ?? ""}
            />
          </div>

          <div className="field">
            <label htmlFor="timeline">Timeline</label>
            <textarea
              id="timeline"
              name="timeline"
              rows={2}
              defaultValue={project.timeline ?? ""}
            />
          </div>

          <div className="field">
            <label htmlFor="nextSteps">Next steps</label>
            <textarea
              id="nextSteps"
              name="nextSteps"
              rows={4}
              defaultValue={project.nextSteps ?? ""}
            />
          </div>

          <div className="field">
            <label htmlFor="githubRepoUrl">GitHub repo URL</label>
            <input
              id="githubRepoUrl"
              name="githubRepoUrl"
              defaultValue={project.githubRepoUrl ?? ""}
            />
          </div>

          <div className="field">
            <label htmlFor="narrativeReadiness">Narrative readiness</label>
            <textarea
              id="narrativeReadiness"
              name="narrativeReadiness"
              rows={2}
              defaultValue={project.narrativeReadiness ?? ""}
            />
          </div>

          <div className="field">
            <label htmlFor="blockers">Blockers</label>
            <textarea
              id="blockers"
              name="blockers"
              rows={2}
              defaultValue={project.blockers ?? ""}
            />
          </div>

          <div className="row">
            <button className="button" type="submit">
              Save
            </button>
            <Link className="button buttonSecondary" href={`/projects/${project.id}`}>
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

