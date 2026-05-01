import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TraceViewer } from "@/components/TraceViewer";

type Props = { params: Promise<{ id: string }> };

type LiteraturePaper = {
  arxivId?: string | null;
  title?: string;
  authors?: string;
  takeaway?: string;
  confidence?: string;
};
type LiteraturePayload = {
  rationale?: string;
  papersProposed?: LiteraturePaper[];
  inputPayload?: unknown;
};

export default async function JobPage({ params }: Props) {
  const { id } = await params;
  const job = await prisma.jobRun.findUnique({
    where: { id },
    select: { id: true, kind: true, payloadJson: true },
  });
  if (!job) notFound();

  let lit: LiteraturePayload | null = null;
  if (job.kind === "literature_review" && job.payloadJson) {
    try {
      lit = JSON.parse(job.payloadJson) as LiteraturePayload;
    } catch {
      lit = null;
    }
  }

  return (
    <div className="container">
      <header className="pageHead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="pageTitle">Agent trace</h1>
          <p className="pageSub">Live log of the Claude session.</p>
        </div>
        <Link className="button buttonSecondary" href="/settings">
          All jobs
        </Link>
      </header>

      {lit ? (
        <section className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Literature-review audit</h3>
          {lit.rationale ? (
            <>
              <div className="muted small" style={{ marginBottom: 4 }}>Claude&apos;s rationale</div>
              <p style={{ whiteSpace: "pre-wrap", margin: "0 0 12px" }}>{lit.rationale}</p>
            </>
          ) : (
            <p className="muted small">No rationale captured for this run.</p>
          )}
          {lit.papersProposed && lit.papersProposed.length > 0 ? (
            <>
              <div className="muted small" style={{ marginBottom: 4 }}>
                Papers proposed ({lit.papersProposed.length})
              </div>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {lit.papersProposed.map((p, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <strong>{p.title ?? "(untitled)"}</strong>
                    {p.arxivId ? (
                      <>
                        {" "}
                        <a
                          className="link small"
                          href={`https://arxiv.org/abs/${p.arxivId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          arXiv:{p.arxivId}
                        </a>
                      </>
                    ) : null}
                    {p.confidence ? (
                      <span className="muted small"> · {p.confidence}</span>
                    ) : null}
                    {p.authors ? <div className="muted small">{p.authors}</div> : null}
                    {p.takeaway ? <div className="small">{p.takeaway}</div> : null}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
      ) : null}

      <TraceViewer jobId={id} />
    </div>
  );
}
