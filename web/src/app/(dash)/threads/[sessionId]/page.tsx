import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { setThreadProject } from "@/lib/server/threadActions";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const [thread, projects] = await Promise.all([
    prisma.thread.findUnique({
      where: { sessionId },
      include: {
        project: { select: { id: true, title: true } },
        turns: { orderBy: { idx: "asc" } },
      },
    }),
    prisma.project.findMany({
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
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
        <form
          action={setThreadProject}
          className="rowWrap"
          style={{ gap: 8, marginTop: 10, alignItems: "center" }}
        >
          <input type="hidden" name="sessionId" value={thread.sessionId} />
          <label className="muted small">Belongs to project:</label>
          <select
            name="projectId"
            defaultValue={thread.projectId ?? ""}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--border2, #ccc)",
              background: "color-mix(in oklab, var(--paper, #fff) 90%, transparent)",
              color: "var(--ink)",
              maxWidth: 360,
            }}
          >
            <option value="">— unassigned —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button type="submit" className="button buttonSecondary" style={{ padding: "6px 12px" }}>
            Save
          </button>
        </form>
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
