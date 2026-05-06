"use client";

import { useActionState, useState } from "react";
import type { ProjectStatus } from "@/generated/prisma/client";
import type { StatusActionState } from "@/lib/server/projectActions";

type Props = {
  action: (
    prev: StatusActionState | null | undefined,
    formData: FormData,
  ) => Promise<StatusActionState>;
  currentStatus: ProjectStatus;
  currentBlockers: string | null;
  statusOptions: ProjectStatus[];
};

/**
 * Status-change form driven by useActionState. On promotion-gate failure,
 * the server action returns `{ ok: false, missing, rationale }` instead of
 * redirecting — so the page never reloads and anything typed into OTHER
 * inputs on the page is preserved. The alert renders inline.
 *
 * When the user picks "blocked", a textarea for the blocker reason
 * appears and is persisted alongside the status change.
 */
export function StatusForm({
  action,
  currentStatus,
  currentBlockers,
  statusOptions,
}: Props) {
  const [state, formAction, pending] = useActionState<
    StatusActionState | null,
    FormData
  >(action, null);
  const [selected, setSelected] = useState<ProjectStatus>(
    state && state.ok === false ? state.attempted : currentStatus,
  );

  const gate = state && state.ok === false ? state : null;

  return (
    <form action={formAction} className="stack">
      {gate ? (
        <div className="alert" style={{ marginBottom: 4 }}>
          <h3>Can&apos;t promote to active yet</h3>
          <div>
            §16.1 requires the following before a project goes active:
          </div>
          <ul>
            {gate.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div
        className="row"
        style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}
      >
        <div className="field">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            name="status"
            value={selected}
            onChange={(e) => setSelected(e.target.value as ProjectStatus)}
          >
            {statusOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 240px" }}>
          <label htmlFor="rationale">Rationale (optional)</label>
          <input
            id="rationale"
            name="rationale"
            defaultValue={gate?.rationale ?? ""}
            key={`rationale-${state && state.ok ? "committed" : "pending"}`}
            placeholder="why now"
          />
        </div>
        <button className="button" type="submit" disabled={pending}>
          {pending ? "…" : "Apply"}
        </button>
      </div>
      {selected === "blocked" ? (
        <div className="field">
          <label htmlFor="blockers">What&apos;s blocking it?</label>
          <textarea
            id="blockers"
            name="blockers"
            rows={2}
            defaultValue={currentBlockers ?? ""}
            placeholder="e.g. waiting on collaborator X to send dataset Y"
          />
        </div>
      ) : null}
    </form>
  );
}
