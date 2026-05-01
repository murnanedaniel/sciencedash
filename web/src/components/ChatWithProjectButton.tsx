"use client";

import { useState, useTransition } from "react";
import {
  autoDetectLocalPathAction,
  setLocalPathAction,
  persistMcpConfigAction,
} from "@/lib/server/chatActions";
import { CopyButton } from "@/components/CopyButton";

type Props = {
  projectId: string;
  localPath: string | null;
  hasRepoLinks: boolean;
  dashboardUrl: string;
};

export function ChatWithProjectButton({
  projectId,
  localPath,
  hasRepoLinks,
  dashboardUrl,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [draftPath, setDraftPath] = useState(localPath ?? "");
  const [isPending, startTransition] = useTransition();
  const [persistResult, setPersistResult] = useState<string | null>(null);

  const sessionName = `sd-${projectId.slice(0, 8)}`;
  // Build the inner claude invocation — explicit --mcp-config so the
  // ScienceDash MCP loads regardless of whether claude auto-discovers
  // .mcp.json, plus --append-system-prompt with a context primer so
  // Claude knows "this project" means the ScienceDash project (not the
  // git repo) and uses MCP for state queries.
  //
  // The context file is created by `Persist .mcp.json` alongside .mcp.json.
  // Falls back gracefully if either file is missing.
  const claudeArgs = localPath
    ? `--mcp-config ${shellQuote(localPath)}/.mcp.json --append-system-prompt "$(cat ${shellQuote(localPath)}/.sciencedash/CHAT_CONTEXT.md 2>/dev/null)"`
    : "";
  const tmuxCmd = localPath
    ? `tmux new -As ${sessionName} 'cd ${shellQuote(localPath)} && (claude --continue ${claudeArgs} 2>/dev/null || claude ${claudeArgs})'`
    : "";

  const ready = !!localPath;

  return (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="button"
        disabled={!ready || isPending}
        onClick={() => setOpen((v) => !v)}
        title={
          ready
            ? "Show the tmux command to chat with this project"
            : "Set a local repo path first"
        }
      >
        Chat with project 💬
      </button>

      {!ready ? (
        <span className="row" style={{ gap: 4 }}>
          {hasRepoLinks ? (
            <form
              action={autoDetectLocalPathAction}
              onSubmit={() => setPersistResult("scanning…")}
            >
              <input type="hidden" name="projectId" value={projectId} />
              <button type="submit" className="button buttonSecondary small" disabled={isPending}>
                Auto-detect
              </button>
            </form>
          ) : null}
          <button
            type="button"
            className="button buttonSecondary small"
            onClick={() => setEditingPath(true)}
          >
            Set path
          </button>
        </span>
      ) : (
        <>
          <span className="muted small" style={{ fontFamily: "var(--font-geist-mono, monospace)" }}>
            {localPath}
          </span>
          <button
            type="button"
            className="button buttonSecondary small"
            onClick={() => setEditingPath(true)}
            title="Change local path"
          >
            Edit
          </button>
        </>
      )}

      {editingPath ? (
        <form
          action={(fd) => {
            setEditingPath(false);
            startTransition(async () => {
              await setLocalPathAction(fd);
            });
          }}
          className="row"
          style={{ gap: 4, marginTop: 4 }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input
            name="localPath"
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            placeholder="/absolute/path/to/repo"
            style={{ minWidth: 320 }}
          />
          <button type="submit" className="button small">
            Save
          </button>
          <button
            type="button"
            className="button buttonSecondary small"
            onClick={() => {
              setEditingPath(false);
              setDraftPath(localPath ?? "");
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}

      {persistResult ? (
        <span className="muted small">{persistResult}</span>
      ) : null}

      {open && ready ? (
        <div
          className="card"
          style={{ flexBasis: "100%", marginTop: 6, padding: 10, fontSize: 13 }}
        >
          <div className="muted small" style={{ marginBottom: 6 }}>
            Paste this into your terminal to start (or resume) Claude in the project
            with ScienceDash MCP loaded:
          </div>
          <pre
            style={{
              background: "var(--card-muted, #f6f6f6)",
              padding: 8,
              borderRadius: 4,
              overflow: "auto",
              fontSize: 12,
              margin: 0,
            }}
          >
            {tmuxCmd}
          </pre>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            <CopyButton value={tmuxCmd} label="Copy command" variant="primary" />
            <CopyButton
              value={`tmux attach -t ${sessionName}`}
              label="Copy attach"
              title="Copy: tmux attach -t … — for re-attaching to an already-running session"
            />
            <form
              action={async (fd) => {
                fd.set("projectId", projectId);
                fd.set("dashboardUrl", dashboardUrl);
                await persistMcpConfigAction(fd);
                setPersistResult(`wrote ${localPath}/.mcp.json`);
                setTimeout(() => setPersistResult(null), 4000);
              }}
            >
              <button
                type="submit"
                className="button buttonSecondary small"
                title="Write .mcp.json into the project repo so future `claude` runs there auto-load the MCP"
              >
                Persist .mcp.json
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-/.~]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
