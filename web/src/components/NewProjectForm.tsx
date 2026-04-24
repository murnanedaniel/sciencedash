"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TagChips } from "@/components/TagChips";

export type NewProjectState =
  | { ok: true }
  | {
      ok: false;
      error: string;
      title: string;
      tags: string;
      hypothesis: string;
    };

type Props = {
  action: (
    prev: NewProjectState | null | undefined,
    formData: FormData,
  ) => Promise<NewProjectState>;
};

/**
 * useActionState-driven new-project form. On validation failure, the server
 * action returns `{ ok: false, error, title, tags, hypothesis }` and the
 * typed fields render from that state. No redirect, no lost input.
 */
export function NewProjectForm({ action }: Props) {
  const [state, formAction, pending] = useActionState<
    NewProjectState | null,
    FormData
  >(action, null);
  const err = state && state.ok === false ? state : null;

  return (
    <form className="stack" action={formAction}>
      {err ? (
        <div className="alert" style={{ marginBottom: 4 }}>
          {err.error}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          defaultValue={err?.title ?? ""}
          placeholder="e.g. Robust tracking under misalignment"
          autoFocus
          required
        />
      </div>

      <div className="field">
        <label htmlFor="tags">Tags</label>
        <TagChips
          name="tags"
          initial={err?.tags ?? ""}
          placeholder="tracking, hl-lhc, ingredient"
        />
      </div>

      <div className="field">
        <label htmlFor="hypothesis">One-line hypothesis</label>
        <input
          id="hypothesis"
          name="hypothesis"
          defaultValue={err?.hypothesis ?? ""}
          placeholder="if X then Y because Z"
        />
      </div>

      <div className="row">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "…" : "Create"}
        </button>
        <Link className="button buttonSecondary" href="/projects">
          Cancel
        </Link>
      </div>
    </form>
  );
}
