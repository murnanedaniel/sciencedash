import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createBlankPaper } from "@/lib/server/paperActions";
import { daysAgoLabel } from "@/lib/format";
import { PaperStatus } from "@/generated/prisma/client";

const COLUMN_ORDER: PaperStatus[] = [
  "skeleton",
  "draft",
  "internal",
  "arxiv",
  "submitted",
  "published",
];

export default async function PapersPage() {
  const papers = await prisma.paper.findMany({
    orderBy: { updatedAt: "desc" },
    include: { primaryProject: { select: { id: true, title: true } } },
  });
  const projects = await prisma.project.findMany({
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
  });

  const byStatus: Record<string, typeof papers> = Object.fromEntries(
    COLUMN_ORDER.map((s) => [s, [] as typeof papers]),
  );
  for (const p of papers) byStatus[p.status]!.push(p);

  return (
    <div className="container">
      <header className="pageHead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="pageTitle">Papers</h1>
          <p className="pageSub">One question, one answer, one paper.</p>
        </div>
      </header>

      <details className="card" style={{ marginBottom: 18 }}>
        <summary className="muted small" style={{ cursor: "pointer" }}>
          New blank paper
        </summary>
        <form action={createBlankPaper} className="row" style={{ flexWrap: "wrap", gap: 10, marginTop: 10 }}>
          <div className="field" style={{ flex: "1 1 280px" }}>
            <label>Title</label>
            <input name="title" required placeholder="e.g. Sparse attention for tracking" />
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Primary project</label>
            <select name="primaryProjectId" defaultValue="">
              <option value="">(none)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <button className="button" type="submit">Create skeleton</button>
        </form>
      </details>

      <div className="kanban">
        {COLUMN_ORDER.map((col) => (
          <div key={col} className="kanbanCol">
            <div className="kanbanHead">
              <span>{col}</span>
              <span>{byStatus[col]!.length}</span>
            </div>
            {byStatus[col]!.map((p) => (
              <Link key={p.id} href={`/papers/${p.id}`} className="kanbanCard">
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
                <div className="muted small">
                  {p.primaryProject ? p.primaryProject.title : "unlinked"} · {daysAgoLabel(p.updatedAt)}
                </div>
              </Link>
            ))}
            {byStatus[col]!.length === 0 ? (
              <div
                className="muted small"
                style={{ padding: "4px 6px", opacity: 0.35, fontStyle: "italic" }}
              >
                empty
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
