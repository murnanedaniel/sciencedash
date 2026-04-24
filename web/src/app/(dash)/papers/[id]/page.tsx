import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatUtc, daysAgoLabel } from "@/lib/format";
import { InlineField } from "@/components/InlineField";
import {
  patchPaperField,
  patchSectionField,
  setPaperStatus,
  addCustomSection,
  deleteSection,
  uploadArtifact,
  deleteArtifact,
  deletePaper,
} from "@/lib/server/paperActions";
import { RunAiSkeletonButton, RunAiPolishButton } from "@/components/RunAiSkeletonButton";
import {
  PaperStatus,
  PaperSectionKind,
} from "@/generated/prisma/client";

type Props = { params: Promise<{ id: string }> };

export default async function PaperDetailPage({ params }: Props) {
  const { id } = await params;
  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      sections: { orderBy: { order: "asc" }, include: { artifacts: true } },
      artifacts: true,
      primaryProject: { select: { id: true, title: true } },
      hypotheses: {
        include: {
          hypothesis: {
            include: {
              project: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });
  if (!paper) notFound();

  return (
    <div className="container">
      <header className="header">
        <div className="stackTight">
          <h1 className="pageTitle">
            <InlineField
              value={paper.title}
              field="title"
              idForAction={paper.id}
              action={patchPaperField}
            />
          </h1>
          <div className="rowWrap">
            <span className="pill" style={{ color: "var(--accent)" }}>{paper.status}</span>
            {paper.primaryProject ? (
              <Link href={`/projects/${paper.primaryProject.id}`} className="pill">
                project: {paper.primaryProject.title}
              </Link>
            ) : null}
            <span className="muted small">
              Updated {formatUtc(paper.updatedAt)} UTC · {daysAgoLabel(paper.updatedAt)}
            </span>
          </div>
        </div>
        <div className="row">
          <Link className="button buttonSecondary" href="/papers">Back</Link>
          <RunAiSkeletonButton paperId={paper.id} />
          <a className="button buttonSecondary" href={`/papers/${paper.id}/export.tex`}>
            Export .tex
          </a>
        </div>
      </header>

      <div className="twoCol">
        <main className="stack">
          <div className="card">
            <h2 className="sectionTitle">Abstract</h2>
            <InlineField
              value={paper.abstract}
              field="abstract"
              idForAction={paper.id}
              action={patchPaperField}
              multiline
              placeholder="One paragraph. Claim in one sentence; why it matters in one sentence; evidence in one sentence."
            />
          </div>

          {paper.sections.map((s) => (
            <div key={s.id} className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div className="sectionTitle" style={{ marginBottom: 6 }}>
                    {s.kind.replace("_", " ")}
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "-0.01em" }}>
                    <InlineField
                      value={s.title}
                      field="title"
                      idForAction={s.id}
                      action={patchSectionField}
                    />
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <RunAiPolishButton sectionId={s.id} />
                  <form action={deleteSection.bind(null, s.id)}>
                    <button type="submit" className="button buttonSecondary" style={{ padding: "4px 8px", fontSize: 12 }}>
                      Delete
                    </button>
                  </form>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <InlineField
                  value={s.contentMd}
                  field="contentMd"
                  idForAction={s.id}
                  action={patchSectionField}
                  multiline
                  placeholder="Body (markdown)."
                />
              </div>

              {s.artifacts.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>Figures</div>
                  <div className="rowWrap">
                    {s.artifacts.map((a) => (
                      <ArtifactThumb key={a.id} path={a.path} caption={a.caption} id={a.id} />
                    ))}
                  </div>
                </div>
              ) : null}

              <details style={{ marginTop: 10 }}>
                <summary className="muted small" style={{ cursor: "pointer" }}>Attach figure</summary>
                <ArtifactForm
                  scope={{ paperId: paper.id, paperSectionId: s.id }}
                />
              </details>
            </div>
          ))}

          <div className="card">
            <h2 className="sectionTitle">Add custom section</h2>
            <form action={addCustomSection.bind(null, paper.id)} className="row" style={{ gap: 10 }}>
              <input name="title" placeholder="Section title" required style={{ flex: 1 }} />
              <select name="kind" defaultValue="custom">
                {Object.values(PaperSectionKind).map((k) => (
                  <option key={k} value={k}>{k.replace("_", " ")}</option>
                ))}
              </select>
              <button className="button" type="submit">Add</button>
            </form>
          </div>

          <div className="card danger">
            <h2 className="sectionTitle">Danger zone</h2>
            <form action={deletePaper.bind(null, paper.id)}>
              <button type="submit" className="button buttonDanger">Delete paper</button>
            </form>
          </div>
        </main>

        <aside className="rail">
          <div className="railItem">
            <time>Status</time>
            <form action={setPaperStatus.bind(null, paper.id)} className="stackTight">
              <select name="status" defaultValue={paper.status}>
                {Object.values(PaperStatus).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <input name="arxivId" placeholder="arXiv id" defaultValue={paper.arxivId ?? ""} />
              <input name="doi" placeholder="doi" defaultValue={paper.doi ?? ""} />
              <input name="venue" placeholder="venue" defaultValue={paper.venue ?? ""} />
              <button type="submit" className="button">Save</button>
            </form>
          </div>

          <div className="railItem">
            <time>Linked hypotheses</time>
            {paper.hypotheses.length === 0 ? (
              <div className="muted">none</div>
            ) : (
              <ul className="stackTight" style={{ listStyle: "none" }}>
                {paper.hypotheses.map((hp) => (
                  <li key={hp.hypothesisId} className="small">
                    <Link className="link" href={`/projects/${hp.hypothesis.project.id}?tab=runs`}>
                      {hp.hypothesis.title}
                    </Link>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {hp.hypothesis.project.title} · verdict {hp.hypothesis.verdict}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ArtifactThumb({
  path,
  caption,
  id,
}: {
  path: string;
  caption: string | null;
  id: string;
}) {
  const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(path);
  return (
    <figure style={{ margin: 0, maxWidth: 220 }}>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={path}
          alt={caption ?? ""}
          style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid var(--border)" }}
        />
      ) : (
        <a href={path} target="_blank" rel="noreferrer" className="pill">
          {path.split("/").pop()}
        </a>
      )}
      <figcaption className="muted small" style={{ marginTop: 4 }}>
        {caption ?? ""}
      </figcaption>
      <form action={deleteArtifact.bind(null, id)}>
        <button type="submit" className="button buttonSecondary" style={{ padding: "2px 6px", fontSize: 11, marginTop: 4 }}>
          Remove
        </button>
      </form>
    </figure>
  );
}

function ArtifactForm({
  scope,
}: {
  scope: { paperId?: string; paperSectionId?: string; projectId?: string; runId?: string };
}) {
  return (
    <form
      action={uploadArtifact.bind(null, scope)}
      className="row"
      style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}
      encType="multipart/form-data"
    >
      <div className="field" style={{ flex: "1 1 240px" }}>
        <label>Caption</label>
        <input name="caption" placeholder="optional" />
      </div>
      <div className="field" style={{ minWidth: 140 }}>
        <label>Kind</label>
        <select name="kind" defaultValue="figure">
          <option value="figure">figure</option>
          <option value="table">table</option>
          <option value="slide">slide</option>
          <option value="checkpoint">checkpoint</option>
          <option value="dataset">dataset</option>
          <option value="other">other</option>
        </select>
      </div>
      <div className="field" style={{ flex: "1 1 260px" }}>
        <label>File</label>
        <input type="file" name="file" required />
      </div>
      <button type="submit" className="button">Upload</button>
    </form>
  );
}
