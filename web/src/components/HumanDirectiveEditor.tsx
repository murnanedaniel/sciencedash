/**
 * HUMAN_DIRECTIVE editor — lives on the Plan tab of the project page.
 *
 * Server component for the read side; renders an inline form whose
 * Save action persists via setHumanDirectiveAction. Stores canonically
 * in Project.brainDirective; mirrors to <localPath>/.sciencedash/
 * HUMAN_DIRECTIVE.md (best-effort) when localPath is set.
 *
 * The next brain heartbeat consumes the directive (clears the field +
 * sets brainDirectiveConsumedAt). If a directive is unconsumed (set,
 * not yet consumed), this editor shows a "pending" state.
 */

import { setHumanDirectiveAction } from "@/lib/server/brainActions";

type Props = {
  projectId: string;
  brainDirective: string | null;
  /** True when brainDirective came from the file mirror (pre-UI or
   *  terminal-written) rather than the DB. UI shows a small note;
   *  the user's first save promotes it to DB-canonical. */
  directiveIsFromFile: boolean;
  brainDirectiveSetAt: Date | null;
  brainDirectiveConsumedAt: Date | null;
  hasLocalPath: boolean;
};

function relTime(d: Date | null): string {
  if (!d) return "never";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function HumanDirectiveEditor({
  projectId,
  brainDirective,
  directiveIsFromFile,
  brainDirectiveSetAt,
  brainDirectiveConsumedAt,
  hasLocalPath,
}: Props) {
  const pending = !!brainDirective;
  const consumedAfterSet =
    brainDirectiveConsumedAt &&
    brainDirectiveSetAt &&
    brainDirectiveConsumedAt.getTime() > brainDirectiveSetAt.getTime();

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <h3 style={{ margin: 0 }}>
          HUMAN_DIRECTIVE{" "}
          <span className="muted small">
            (consumed once per brain heartbeat)
          </span>
        </h3>
        <span className="muted small">
          {pending && directiveIsFromFile ? (
            <>loaded from <code>HUMAN_DIRECTIVE.md</code> · save to promote to DB</>
          ) : pending ? (
            <>pending · set {relTime(brainDirectiveSetAt)}</>
          ) : consumedAfterSet ? (
            <>consumed {relTime(brainDirectiveConsumedAt)}</>
          ) : brainDirectiveConsumedAt ? (
            <>last consumed {relTime(brainDirectiveConsumedAt)}</>
          ) : (
            <>none</>
          )}
        </span>
      </div>

      <p className="muted small" style={{ marginTop: 6 }}>
        Steers the next brain cycle. Saved directives are read on the
        next heartbeat, distilled into MEMORY_LOG, and cleared.
        {hasLocalPath
          ? " Also mirrored to <localPath>/.sciencedash/HUMAN_DIRECTIVE.md so a terminal Claude can read it."
          : " (Set a localPath to also mirror this to the repo for terminal Claude.)"}
      </p>

      <form action={setHumanDirectiveAction} className="stack" style={{ gap: 8, marginTop: 8 }}>
        <input type="hidden" name="projectId" value={projectId} />
        <textarea
          name="body"
          defaultValue={brainDirective ?? ""}
          rows={6}
          placeholder={
            "Focus: <one short paragraph on what's most pressing right now>.\n\nDon't surface anything about <topics> until <unblocking event>.\n\nUntil then: silence is fine."
          }
          style={{
            width: "100%",
            fontFamily: "var(--font-display, system-ui)",
            fontSize: 13,
            lineHeight: 1.5,
            padding: 8,
            resize: "vertical",
            minHeight: 100,
          }}
        />
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button type="submit" className="button">
            {pending ? "Update directive" : "Save directive"}
          </button>
        </div>
      </form>

      {pending ? (
        <form action={setHumanDirectiveAction} style={{ marginTop: 4 }}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="body" value="" />
          <button
            type="submit"
            className="button buttonSecondary small"
            title="Discard the pending directive without consuming it"
          >
            Clear pending directive
          </button>
        </form>
      ) : null}
    </div>
  );
}
