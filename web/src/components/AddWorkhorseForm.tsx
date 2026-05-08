"use client";

import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";

type Props = {
  projectId: string;
  projectTitle: string;
  dashboardOrigin: string;
  /** Bearer token for the curl Authorization header. Server passes it
   *  in; mirrors the same security trade-off as the brain-chat
   *  launcher (single-user system, token visible only to the
   *  authenticated dashboard session). */
  token: string;
};

/**
 * Always-rendered "Add a workhorse" affordance on the project page's
 * Workhorses panel. Takes the absolute repo path on the *target host*
 * (where the user will paste the command), then renders a one-liner
 * they paste in their terminal there.
 *
 * Behaviour: same one-liner works for fresh hosts (writes config) and
 * hosts that already have other workhorses (merges into the existing
 * config.json's projects[]). The bash launcher script handles both.
 */
export function AddWorkhorseForm({
  projectId,
  projectTitle,
  dashboardOrigin,
  token,
}: Props) {
  const defaultRepo = `~/research/${slugify(projectTitle)}`;
  const [repo, setRepo] = useState(defaultRepo);
  const trimmed = repo.trim();

  const launchUrl =
    `${dashboardOrigin}/api/workhorse-bootstrap/launch` +
    `?projectId=${encodeURIComponent(projectId)}` +
    `&repo=${encodeURIComponent(trimmed)}`;

  const oneLiner =
    `bash <(curl -fsSL -H "Authorization: Bearer ${token}" "${launchUrl}")`;

  const valid = trimmed.startsWith("/") || trimmed.startsWith("~");
  const tokenPresent = token.length > 0;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        border: "1px dashed var(--border, #d0d0d0)",
        borderRadius: 6,
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>Add a workhorse</strong>
        <span className="muted small">
          Run on whichever compute host you want (Perlmutter, Vast, …)
        </span>
      </div>

      {!tokenPresent ? (
        <p className="muted small" style={{ marginTop: 8 }}>
          <code>SCIENCEDASH_AUTH_TOKEN</code> isn&apos;t set in the dashboard&apos;s
          environment, so we can&apos;t generate a working command. Set it in{" "}
          <code>.env</code> and restart the server.
        </p>
      ) : (
        <>
          <div
            className="row"
            style={{
              gap: 6,
              alignItems: "center",
              marginTop: 8,
              flexWrap: "wrap",
            }}
          >
            <label
              className="muted small"
              style={{ minWidth: 200 }}
              htmlFor={`wh-repo-${projectId}`}
            >
              Absolute path to the repo on the target host
            </label>
            <input
              id={`wh-repo-${projectId}`}
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="/global/homes/m/.../research/<repo>"
              style={{
                flex: "1 1 320px",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: 12,
                padding: "4px 8px",
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          {!valid ? (
            <p className="muted small" style={{ marginTop: 4 }}>
              Path should start with <code>/</code> or <code>~</code>.
            </p>
          ) : null}
          <pre
            style={{
              background: "var(--card-muted, #f6f6f6)",
              padding: 8,
              borderRadius: 4,
              overflow: "auto",
              fontSize: 11,
              margin: "8px 0 0",
              whiteSpace: "pre",
            }}
          >
            {oneLiner}
          </pre>
          <div
            className="row"
            style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}
          >
            <CopyButton
              value={oneLiner}
              label="Copy command"
              variant="primary"
            />
            <span className="muted small">
              SSH to the host first; <code>bash &lt;(curl …)</code> needs an
              interactive shell so tmux gets a TTY.
            </span>
          </div>
          <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
            Re-running on a host that already has other workhorses is safe —
            the script merges this project into the existing{" "}
            <code>~/.sciencedash/config.json</code>.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Lowercase-kebab from a project title. Caps to 40 chars to avoid
 * silly-long default paths.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40)
    || "project";
}
