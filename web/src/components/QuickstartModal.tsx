"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function QuickstartButton({
  projectId,
  projectTitle,
  defaultTemplate = "",
}: {
  projectId: string;
  projectTitle: string;
  defaultTemplate?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button"
        onClick={() => setOpen(true)}
        title="Create a new repo from template and let Claude scaffold it"
      >
        Quickstart repo ✨
      </button>
      {open ? (
        <QuickstartModalBody
          projectId={projectId}
          defaultName={slugify(projectTitle)}
          defaultTemplate={defaultTemplate}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function QuickstartModalBody({
  projectId,
  defaultName,
  defaultTemplate,
  onClose,
}: {
  projectId: string;
  defaultName: string;
  defaultTemplate: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [template, setTemplate] = useState(defaultTemplate);
  const [instructions, setInstructions] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch("/api/agent/repo-quickstart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          name,
          instructions,
          isPrivate,
          template: template.trim() || undefined,
        }),
      });
      const data = (await resp.json()) as { jobId?: string; error?: string };
      if (!resp.ok || !data.jobId) {
        setError(data.error ?? `HTTP ${resp.status}`);
        setBusy(false);
        return;
      }
      router.push(`/jobs/${data.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="helpBackdrop" onClick={onClose}>
      <div
        className="paletteBox"
        style={{ width: "min(560px, 92vw)", padding: 0, marginTop: "12vh", alignSelf: "flex-start", marginLeft: "auto", marginRight: "auto" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Quickstart repo"
      >
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div className="brandName" style={{ fontSize: 18 }}>Quickstart new repo</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Creates a GitHub repo from the template and asks Claude to populate it from your project context.
          </div>
        </div>

        <div className="stack" style={{ padding: "18px 22px", gap: 14 }}>
          <div className="field">
            <label htmlFor="qsn">Repo name</label>
            <input
              id="qsn"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. tracking-under-misalignment"
            />
          </div>

          <div className="field">
            <label htmlFor="qst">Template repo (owner/repo)</label>
            <input
              id="qst"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="e.g. murnanedaniel/paper-template"
            />
            <div className="muted small" style={{ marginTop: 4 }}>
              Must be a GitHub template repo you own or can access with your GITHUB_PAT.
              {defaultTemplate ? " Default comes from SCIENCEDASH_REPO_TEMPLATE." : ""}
            </div>
          </div>

          <div className="field">
            <label htmlFor="qsi">Special instructions (optional)</label>
            <textarea
              id="qsi"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              placeholder="Anything specific the agent should do when populating the template — e.g. &quot;add a figures/ dir, reference the ColliderML v2 dataset in the README.&quot;"
            />
          </div>

          <div className="field">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                style={{ width: "auto" }}
              />
              Make it private
            </label>
          </div>

          {error ? (
            <div className="alert">{error}</div>
          ) : null}

          <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="button buttonSecondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="button"
              onClick={submit}
              disabled={busy || !name.trim() || !template.trim()}
            >
              {busy ? "…" : "Create + scaffold"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
