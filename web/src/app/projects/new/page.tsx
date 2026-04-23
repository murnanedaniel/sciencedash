import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProjectStatus, ProjectType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/tags";

async function createProject(formData: FormData) {
  "use server";

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim() as ProjectType;
  const status = String(formData.get("status") ?? "").trim() as ProjectStatus;

  const tagsInput = String(formData.get("tags") ?? "").trim();
  const tags = parseTags(tagsInput);

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

  const project = await prisma.project.create({
    data: {
      title,
      type,
      status,
      tags: {
        connectOrCreate: tags.map((name) => ({
          where: { name },
          create: { name },
        })),
      },
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
  redirect(`/projects/${project.id}`);
}

export default function NewProjectPage() {
  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)" }}>New project</h1>
          <p className="muted">
            Keep it paper-sized: one question, one answer, one output.
          </p>
        </div>
        <Link className="button buttonSecondary" href="/projects">
          Back
        </Link>
      </header>

      <main className="card">
        <form className="stack" action={createProject}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              name="title"
              placeholder="e.g. Robust tracking under misalignment"
              required
            />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" name="type" defaultValue={ProjectType.exploit}>
                {Object.values(ProjectType).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={ProjectStatus.idea}>
                {Object.values(ProjectStatus).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="tags">Tags</label>
            <input
              id="tags"
              name="tags"
              placeholder="e.g. tracking, hl-lhc, misalignment"
            />
            <div className="muted small">
              Tip: comma or space separated; stored normalized (e.g. “HL-LHC” → “hl-lhc”).
            </div>
          </div>

          <div className="field">
            <label htmlFor="hypothesis">Hypothesis</label>
            <textarea id="hypothesis" name="hypothesis" rows={3} />
          </div>

          <div className="field">
            <label htmlFor="figuresOfMerit">Figures of merit</label>
            <textarea id="figuresOfMerit" name="figuresOfMerit" rows={3} />
          </div>

          <div className="field">
            <label htmlFor="timeline">Timeline</label>
            <textarea id="timeline" name="timeline" rows={2} />
          </div>

          <div className="field">
            <label htmlFor="nextSteps">Next steps</label>
            <textarea id="nextSteps" name="nextSteps" rows={4} />
          </div>

          <div className="field">
            <label htmlFor="githubRepoUrl">GitHub repo URL</label>
            <input id="githubRepoUrl" name="githubRepoUrl" placeholder="https://github.com/..." />
          </div>

          <div className="field">
            <label htmlFor="narrativeReadiness">Narrative readiness</label>
            <textarea id="narrativeReadiness" name="narrativeReadiness" rows={2} />
          </div>

          <div className="field">
            <label htmlFor="blockers">Blockers</label>
            <textarea id="blockers" name="blockers" rows={2} />
          </div>

          <div className="row">
            <button className="button" type="submit">
              Create
            </button>
            <Link className="button buttonSecondary" href="/projects">
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

