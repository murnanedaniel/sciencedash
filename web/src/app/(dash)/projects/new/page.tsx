import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProjectType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/tags";

async function createProject(formData: FormData) {
  "use server";

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "exploit") as
    | "exploit"
    | "explore"
    | "system";
  const hypothesis = String(formData.get("hypothesis") ?? "").trim() || null;
  const tagsInput = String(formData.get("tags") ?? "").trim();
  const tags = parseTags(tagsInput);

  if (!title) throw new Error("Title is required.");

  const project = await prisma.project.create({
    data: {
      title,
      type,
      hypothesis,
      tags: {
        connectOrCreate: tags.map((name) => ({
          where: { name },
          create: { name },
        })),
      },
    },
  });

  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

export default function NewProjectPage() {
  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">New project</h1>
        <p className="pageSub">
          Start small. Title, type, one-line hypothesis — flesh out the rest on the
          project page.
        </p>
      </header>

      <main className="card" style={{ maxWidth: 640 }}>
        <form className="stack" action={createProject}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              name="title"
              placeholder="e.g. Robust tracking under misalignment"
              autoFocus
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
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="tags">Tags</label>
              <input
                id="tags"
                name="tags"
                placeholder="tracking, hl-lhc, misalignment"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="hypothesis">One-line hypothesis</label>
            <input
              id="hypothesis"
              name="hypothesis"
              placeholder="if X then Y because Z"
            />
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
