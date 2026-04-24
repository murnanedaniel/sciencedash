import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/tags";
import { TagChips } from "@/components/TagChips";

async function createProject(formData: FormData) {
  "use server";

  const title = String(formData.get("title") ?? "").trim();
  const hypothesis = String(formData.get("hypothesis") ?? "").trim() || null;
  const tagsInput = String(formData.get("tags") ?? "").trim();
  const tags = parseTags(tagsInput);

  if (!title) throw new Error("Title is required.");

  const project = await prisma.project.create({
    data: {
      title,
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
          Start small. Title, tags, one-line hypothesis — flesh out the rest on the
          project page.
        </p>
      </header>

      <main className="card" style={{ maxWidth: 720 }}>
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

          <div className="field">
            <label htmlFor="tags">Tags</label>
            <TagChips name="tags" placeholder="tracking, hl-lhc, ingredient" />
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
