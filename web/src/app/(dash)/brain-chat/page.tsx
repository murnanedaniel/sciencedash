import { prisma } from "@/lib/prisma";
import { CopyButton } from "@/components/CopyButton";
import { daysAgoLabel, formatUtc } from "@/lib/format";
import { resolveDashboardOrigin } from "@/lib/brain/dashboard-origin";

export const dynamic = "force-dynamic";

/**
 * Brain chat page — the daily one-liner pulls a self-contained bash
 * launcher from /api/brain-chat/launch and pipes it into bash. The
 * launcher writes ~/.sciencedash/brain-chat/{.mcp.json, CHAT_CONTEXT.md}
 * with a fresh context snapshot and drops the user into a tmux + claude
 * session. Token is mirrored from the curl Authorization header into
 * the .mcp.json so the chat Claude can talk to /api/mcp.
 *
 * Below the bootstrap, recent persisted BrainChat sessions are listed
 * with collapsible transcripts.
 */
export default async function BrainChatPage() {
  const [recent, dashboardOrigin, token] = await Promise.all([
    prisma.brainChat.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    resolveDashboardOrigin(),
    Promise.resolve(process.env.SCIENCEDASH_AUTH_TOKEN ?? ""),
  ]);

  const tokenPresent = token.length > 0;
  const launchUrl = `${dashboardOrigin}/api/brain-chat/launch`;
  // Use bash process substitution `bash <(curl ...)` rather than the more
  // familiar `curl ... | bash`. The pipe form gives bash no controlling
  // TTY (stdin is the pipe), so tmux fails with "open terminal failed:
  // not a terminal". Process substitution preserves the user's TTY on
  // stdin while reading the script from a /dev/fd/N — tmux gets a real
  // terminal and the chat session opens cleanly.
  const oneLiner = `bash <(curl -fsSL -H "Authorization: Bearer ${token}" ${launchUrl})`;
  const aliasLine = `alias brain='bash <(curl -fsSL -H "Authorization: Bearer ${token}" ${launchUrl})'`;
  const attachLine = "tmux attach -t sd-brain";

  return (
    <div className="container">
      <header className="pageHead">
        <div>
          <h1 className="pageTitle">Brain chat</h1>
          <p className="pageSub">
            Shoot the shit with the global brain. The launcher pulls fresh
            context (programmes, projects, blockers, recent agent traffic,
            prior chat summaries) every time you start a session.
          </p>
        </div>
      </header>

      <div className="stack">
        <div className="card">
          <h2 className="sectionTitle">Start a chat</h2>
          {!tokenPresent ? (
            <p className="muted">
              <code>SCIENCEDASH_AUTH_TOKEN</code> is not set in the
              dashboard&apos;s environment. Set it in <code>.env</code> and
              restart the server to enable the bootstrap.
            </p>
          ) : (
            <>
              <p className="muted small" style={{ marginBottom: 6 }}>
                Daily one-liner — pipes a self-contained bash launcher
                into your shell. Drops you into a tmux session running{" "}
                <code>claude</code> with the ScienceDash MCP and a
                current-state primer loaded.
              </p>
              <Snippet value={oneLiner} />

              <p
                className="muted small"
                style={{ marginTop: 14, marginBottom: 6 }}
              >
                One-time setup — append this to your <code>~/.bashrc</code>{" "}
                (or zshrc) to launch with just <code>brain</code>:
              </p>
              <Snippet value={aliasLine} />

              <p
                className="muted small"
                style={{ marginTop: 14, marginBottom: 6 }}
              >
                Re-attach to an already-running session (e.g. another
                terminal closed):
              </p>
              <Snippet value={attachLine} />

              <p
                className="muted small"
                style={{ marginTop: 14, marginBottom: 0 }}
              >
                When you&apos;re done, tell the chat &ldquo;we&apos;re
                done&rdquo; — it persists the session here via{" "}
                <code>submit_brain_chat</code>. The next global brain
                heartbeat fills in the bullet summary if you didn&apos;t.
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h2 className="sectionTitle">
            Recent chats{" "}
            <span className="muted small">({recent.length})</span>
          </h2>
          {recent.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              No chats persisted yet. Once you finish a session, it&apos;ll
              appear here with a summary the next heartbeat fills in.
            </p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {recent.map((c) => (
                <details key={c.id} className="card" style={{ padding: 10 }}>
                  <summary
                    style={{ cursor: "pointer", listStyle: "revert" }}
                    className="row"
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{c.title}</strong>
                      <span className="muted small">
                        {" · "}
                        {formatUtc(c.createdAt)} UTC ·{" "}
                        {daysAgoLabel(c.createdAt)}
                        {" · "}
                        {c.summaryMd ? "summarised" : "summary pending"}
                      </span>
                    </div>
                  </summary>
                  {c.summaryMd ? (
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        fontSize: 13,
                        margin: "8px 0 0",
                        fontFamily: "var(--font-display, system-ui)",
                      }}
                    >
                      {c.summaryMd}
                    </pre>
                  ) : (
                    <p className="muted small" style={{ marginTop: 8 }}>
                      Summary pending — the next global brain heartbeat
                      will fill this in.
                    </p>
                  )}
                  <details style={{ marginTop: 10 }}>
                    <summary
                      className="muted small"
                      style={{ cursor: "pointer" }}
                    >
                      transcript
                    </summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        fontSize: 12,
                        margin: "8px 0 0",
                        background: "var(--card-muted, #f6f6f6)",
                        padding: 8,
                        borderRadius: 4,
                      }}
                    >
                      {c.transcriptMd}
                    </pre>
                  </details>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Snippet({ value }: { value: string }) {
  return (
    <div
      className="row"
      style={{ gap: 8, alignItems: "stretch", flexWrap: "nowrap" }}
    >
      <pre
        style={{
          flex: 1,
          background: "var(--card-muted, #f6f6f6)",
          padding: 8,
          borderRadius: 4,
          overflow: "auto",
          fontSize: 12,
          margin: 0,
          whiteSpace: "pre",
        }}
      >
        {value}
      </pre>
      <CopyButton value={value} label="Copy" />
    </div>
  );
}
