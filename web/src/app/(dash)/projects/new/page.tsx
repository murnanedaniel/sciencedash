import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/tags";
import {
  NewProjectForm,
  type NewProjectState,
} from "@/components/NewProjectForm";

async function createProject(
  _prev: NewProjectState | null | undefined,
  formData: FormData,
): Promise<NewProjectState> {
  "use server";

  const title = String(formData.get("title") ?? "").trim();
  const tagsInput = String(formData.get("tags") ?? "").trim();
  const hypothesis = String(formData.get("hypothesis") ?? "").trim();

  if (!title) {
    return {
      ok: false,
      error: "Title is required.",
      title,
      tags: tagsInput,
      hypothesis,
    };
  }

  const tags = parseTags(tagsInput);
  const project = await prisma.project.create({
    data: {
      title,
      hypothesis: hypothesis || null,
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
          Start small. Title, tags, one-line hypothesis — flesh out the rest on
          the project page.
        </p>
      </header>

      <main className="card" style={{ maxWidth: 720 }}>
        <NewProjectForm action={createProject} />
      </main>
    </div>
  );
}
