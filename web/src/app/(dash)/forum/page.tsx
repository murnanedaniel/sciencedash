import Link from "next/link";
import { notFound } from "next/navigation";
import { NewForumForm } from "@/components/NewForumForm";
import { forumClaudeModel, forumCodexModel, forumEnabled } from "@/lib/config";
import { reconcileStale } from "@/lib/forum/sessions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ForumIndexPage() {
  if (!forumEnabled()) notFound();

  await reconcileStale();

  const [forums, projects] = await Promise.all([
    prisma.forum.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        participants: { select: { handle: true, model: true } },
        project: { select: { id: true, title: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.project.findMany({
      where: { status: { in: ["idea", "active", "blocked"] } },
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <div className="container">
      <div className="stack">
        <header className="pageHead">
          <h1 className="pageTitle">Forum</h1>
          <p className="pageSub">
            Put two models in a room and watch them argue. You can interject at
            any time — your message interrupts whoever is mid-turn. Participants
            get a read-and-research surface only: files, repo search, the web,
            and the ScienceDash store. They cannot edit anything.
          </p>
        </header>

        <NewForumForm
          projects={projects}
          claudeModel={forumClaudeModel()}
          codexModel={forumCodexModel()}
        />

        <section className="stackTight">
          <h2 className="sectionTitle">Recent</h2>
          {forums.length === 0 ? (
            <p className="muted small">No forums yet.</p>
          ) : (
            forums.map((forum) => (
              <Link
                key={forum.id}
                href={`/forum/${forum.id}`}
                className="card cardLink"
              >
                <div className="cardTitleRow">
                  <span className="cardTitle">{forum.title}</span>
                  <span className="pill">{forum.status}</span>
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {forum.participants
                    .map((participant) => `@${participant.handle}`)
                    .join(" · ")}
                  {" · "}
                  {forum._count.messages} message
                  {forum._count.messages === 1 ? "" : "s"}
                  {forum.costUsd > 0 ? ` · $${forum.costUsd.toFixed(4)}` : ""}
                  {forum.project ? ` · ${forum.project.title}` : ""}
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
