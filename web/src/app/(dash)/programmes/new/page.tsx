import Link from "next/link";
import { createProgrammeAction } from "@/lib/server/programmeActions";

/**
 * /programmes/new — minimal create form. Server action redirects to
 * the new programme's detail page on success.
 */
export default function NewProgrammePage() {
  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">New programme</h1>
        <p className="pageSub">
          Coordinated cluster of related projects sharing a publication
          strategy. Name is required; everything else is editable later.
        </p>
      </header>

      <div className="card">
        <form action={createProgrammeAction} className="stack">
          <label className="field">
            <span className="muted small">Name (unique)</span>
            <input
              name="name"
              required
              autoFocus
              placeholder="e.g. ColliderML tracking"
              style={{ fontSize: 14 }}
            />
          </label>
          <label className="field">
            <span className="muted small">Thesis (markdown)</span>
            <textarea
              name="description"
              rows={4}
              placeholder="What story is this programme trying to tell, across N projects?"
              style={{ fontFamily: "var(--font-geist-mono)", fontSize: 13 }}
            />
          </label>
          <label className="field">
            <span className="muted small">Target venues</span>
            <input
              name="targetVenues"
              placeholder="JINST, Comput Phys Comm, NeurIPS"
              style={{ fontSize: 13 }}
            />
          </label>
          <label className="field">
            <span className="muted small">Figures of merit (programme-level)</span>
            <textarea
              name="figuresOfMerit"
              rows={2}
              placeholder="What counts as winning across the children?"
              style={{ fontFamily: "var(--font-geist-mono)", fontSize: 13 }}
            />
          </label>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <Link className="button buttonSecondary" href="/programmes">
              Cancel
            </Link>
            <button type="submit" className="button">
              Create programme
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
