import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import Link from "next/link";

/**
 * /docs/setup — the per-project onboarding walkthrough.
 *
 * Source of truth is docs/setup-tutorial.md at the repo root. Edit
 * that file as the platform evolves; this page just renders it.
 */

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function SetupTutorialPage() {
  const md = await readFile(
    join(process.cwd(), "..", "docs", "setup-tutorial.md"),
    "utf8",
  ).catch(() => null);

  if (!md) {
    return (
      <div className="container">
        <header className="pageHead">
          <h1 className="pageTitle">Setup tutorial</h1>
        </header>
        <div className="card">
          <p className="muted">
            Tutorial not found at <code>docs/setup-tutorial.md</code>.
          </p>
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
          <h1 className="pageTitle">Setup tutorial</h1>
          <p className="pageSub">
            One-time per-project onboarding. Live from{" "}
            <code>docs/setup-tutorial.md</code>.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link className="button buttonSecondary small" href="/docs">
            Reference docs
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
