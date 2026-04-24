import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createNote, deleteNote, patchNoteField } from "@/lib/server/noteActions";
import { daysAgoLabel } from "@/lib/format";
import { InlineField } from "@/components/InlineField";
import { ArxivAutofill } from "@/components/ArxivAutofill";
import { NoteKind } from "@/generated/prisma/client";

export default async function ReadingPage() {
  const notes = await prisma.note.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      projects: { include: { project: { select: { id: true, title: true } } } },
    },
  });
  const projects = await prisma.project.findMany({
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Reading</h1>
        <p className="pageSub">Papers, books, talks — one-line takeaways.</p>
      </header>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 className="sectionTitle">Add note</h2>
        <form action={createNote} className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="field" style={{ flex: "1 1 320px" }}>
            <label>URL (arXiv or any)</label>
            <ArxivAutofill />
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label>Kind</label>
            <select name="kind" defaultValue="paper">
              {Object.values(NoteKind).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 280px" }}>
            <label>Title</label>
            <input name="title" placeholder="optional (auto if arXiv id)" />
          </div>
          <div className="field" style={{ flex: "1 1 200px" }}>
            <label>Authors</label>
            <input name="authors" />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label>One-line takeaway</label>
            <input name="takeaway" placeholder="the single sentence you'd remember" />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label>Summary (markdown)</label>
            <textarea name="summaryMd" rows={3} />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label>Linked projects</label>
            <select name="projectIds" multiple size={4}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            <div className="muted small">
              Hold Ctrl/⌘ to select multiple. (Autofill coming in M3.)
            </div>
          </div>
          <button className="button" type="submit">Save note</button>
        </form>
      </div>

      {notes.length === 0 ? (
        <div className="card muted">No notes yet.</div>
      ) : (
        <div className="stack">
          {notes.map((n) => (
            <div key={n.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}>
                    <InlineField value={n.title} field="title" idForAction={n.id} action={patchNoteField} />
                  </div>
                  <div className="rowWrap" style={{ marginTop: 4 }}>
                    <span className="pill">{n.kind}</span>
                    {n.arxivId ? <span className="pill">arXiv:{n.arxivId}</span> : null}
                    {n.url ? (
                      <a className="pill" href={n.url} target="_blank" rel="noreferrer">link</a>
                    ) : null}
                    <span className="muted small">{daysAgoLabel(n.createdAt)}</span>
                  </div>
                </div>
                <form action={deleteNote.bind(null, n.id)}>
                  <button type="submit" className="button buttonSecondary" style={{ padding: "4px 8px", fontSize: 12 }}>
                    Delete
                  </button>
                </form>
              </div>

              <div style={{ marginTop: 10 }}>
                <label className="muted small">Authors</label>
                <InlineField value={n.authors} field="authors" idForAction={n.id} action={patchNoteField} />
              </div>
              <div style={{ marginTop: 8 }}>
                <label className="muted small">Takeaway</label>
                <InlineField value={n.takeaway} field="takeaway" idForAction={n.id} action={patchNoteField} placeholder="one line" />
              </div>
              <div style={{ marginTop: 8 }}>
                <label className="muted small">Summary</label>
                <InlineField value={n.summaryMd} field="summaryMd" idForAction={n.id} action={patchNoteField} multiline />
              </div>

              {n.projects.length ? (
                <div className="rowWrap" style={{ marginTop: 10 }}>
                  {n.projects.map((np) => (
                    <Link key={np.projectId} className="pill" href={`/projects/${np.projectId}`}>
                      {np.project.title}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
