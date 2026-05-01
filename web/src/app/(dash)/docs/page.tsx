import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import Link from "next/link";

/**
 * /docs — comprehensive tutorial.
 *
 * Reads docs/tutorial.md from the repo root and renders via `marked`.
 * Cached for 60 s in dev so doc edits show up without a rebuild.
 */

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function DocsPage() {
  const tutorialPath = join(process.cwd(), "..", "docs", "tutorial.md");
  let md: string;
  try {
    md = await readFile(tutorialPath, "utf8");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return (
      <div className="container">
        <header className="pageHead">
          <h1 className="pageTitle">Docs</h1>
        </header>
        <div className="card">
          <p className="muted">Tutorial not found at <code>docs/tutorial.md</code>: {err}</p>
        </div>
      </div>
    );
  }
  const html = await marked.parse(md, { gfm: true });

  return (
    <div className="container">
      <header
        className="pageHead"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}
      >
        <div>
          <h1 className="pageTitle">Docs</h1>
          <p className="pageSub">
            How the platform actually works. Live from <code>docs/tutorial.md</code> at the
            repo root.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link className="button small" href="/docs/setup">
            Setup walkthrough →
          </Link>
          <Link className="button buttonSecondary small" href="/">
            ← /today
          </Link>
        </div>
      </header>
      <article
        className="card prose docsBody"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
