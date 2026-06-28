import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const thread = await prisma.thread.findUnique({
    where: { sessionId },
    include: {
      project: { select: { id: true, title: true } },
      turns: { orderBy: { idx: "asc" } },
    },
  });
  if (!thread) notFound();

  return (
    <div className="container">
      <header className="pageHead">
        <Link href="/search" className="muted small">
          ← Conversations
        </Link>
        <h1 className="pageTitle" style={{ marginTop: 6 }}>
          {thread.title || "(untitled session)"}
        </h1>
        <div className="rowWrap" style={{ gap: 6, marginTop: 6 }}>
          <span className="pill">{thread.machine}</span>
          {thread.project && (
            <Link href={`/projects/${thread.project.id}`} className="pill">
              {thread.project.title}
            </Link>
          )}
          <span className="pill">{thread.turnCount} turns</span>
          <span className="muted small">
            <code style={{ fontFamily: "var(--font-geist-mono)" }}>{thread.cwd}</code>
          </span>
        </div>
      </header>

      <div className="stack">
        {thread.turns.map((t) => (
          <div key={t.id} className="card">
            <div className="sectionTitle">
              {t.role}
              {t.toolName ? ` · ${t.toolName}` : ""}
            </div>
            <div className="mdBody" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {t.text}
            </div>
          </div>
        ))}
        {thread.turns.length === 0 && (
          <p className="muted">No rendered turns (tool-only or empty session).</p>
        )}
      </div>
    </div>
  );
}
