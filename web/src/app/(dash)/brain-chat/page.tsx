import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { CopyButton } from "@/components/CopyButton";
import { daysAgoLabel, formatUtc } from "@/lib/format";
import { buildBrainChatContext } from "@/lib/brain/chat-context";

export const dynamic = "force-dynamic";

/**
 * Brain chat page — renders a copy-pasteable shell heredoc that bootstraps
 * a local Claude REPL with the ScienceDash MCP loaded and a CHAT_CONTEXT
 * primer covering current programmes, projects, blockers, recent agent
 * messages, and prior chat summaries. Below the bootstrap, lists recent
 * persisted BrainChat sessions with their summaries.
 */
export default async function BrainChatPage() {
  const [primer, recent, dashboardOrigin, token] = await Promise.all([
    buildBrainChatContext(),
    prisma.brainChat.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    resolveDashboardOrigin(),
    Promise.resolve(process.env.SCIENCEDASH_AUTH_TOKEN ?? ""),
  ]);

  const tokenPresent = token.length > 0;
  const bootstrap = tokenPresent
    ? buildBootstrapCommand({ dashboardOrigin, token, primer })
    : "";

  return (
    <div className="container">
      <header className="pageHead">
        <div>
          <h1 className="pageTitle">Brain chat</h1>
          <p className="pageSub">
            Shoot the shit with the global brain. The chat loads with your
            current programmes / projects / blockers / recent agent traffic
            already in context.
          </p>
        </div>
      </header>

      <div className="stack">
        <div className="card">
          <h2 className="sectionTitle">Start (or resume) a chat</h2>
          {tokenPresent ? (
            <>
              <p className="muted small" style={{ marginBottom: 8 }}>
                Paste this into a terminal on whatever machine you want to chat
                from. Writes <code>~/.sciencedash/brain-chat/.mcp.json</code> +{" "}
                <code>CHAT_CONTEXT.md</code>, then drops you into a tmux session
                running <code>claude</code> with the ScienceDash MCP loaded.
                Subsequent runs resume the same session via{" "}
                <code>claude --continue</code>.
              </p>
              <pre
                style={{
                  background: "var(--card-muted, #f6f6f6)",
                  padding: 10,
                  borderRadius: 4,
                  overflow: "auto",
                  fontSize: 12,
                  margin: 0,
                  whiteSpace: "pre",
                }}
              >
                {bootstrap}
              </pre>
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <CopyButton value={bootstrap} label="Copy command" variant="primary" />
                <CopyButton
                  value="tmux attach -t sd-brain"
                  label="Copy attach"
                  title="Re-attach to an already-running brain-chat session"
                />
              </div>
              <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
                When you&apos;re done, tell the chat &ldquo;we&apos;re done&rdquo; — it&apos;ll
                call <code>submit_brain_chat</code> to persist the session here. The
                next global brain heartbeat will summarise it if you didn&apos;t.
              </p>
            </>
          ) : (
            <p className="muted">
              <code>SCIENCEDASH_AUTH_TOKEN</code> is not set in the dashboard&apos;s
              environment. Set it in <code>.env</code> and restart the server to
              enable the bootstrap.
            </p>
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
                        {formatUtc(c.createdAt)} UTC · {daysAgoLabel(c.createdAt)}
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
                      Summary pending — the next global brain heartbeat will fill
                      this in.
                    </p>
                  )}
                  <details style={{ marginTop: 10 }}>
                    <summary className="muted small" style={{ cursor: "pointer" }}>
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

/**
 * Resolve the public origin (scheme + host) the local Claude REPL should
 * call to reach this dashboard. Prefers SCIENCEDASH_BASE_URL when set
 * (canonical for the homebox), falls back to X-Forwarded-{Host,Proto}
 * (set by the proxy in front of dev / local), then to the Host header.
 */
async function resolveDashboardOrigin(): Promise<string> {
  const env = process.env.SCIENCEDASH_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function buildBootstrapCommand(args: {
  dashboardOrigin: string;
  token: string;
  primer: string;
}): string {
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        sciencedash: {
          type: "http",
          url: `${args.dashboardOrigin}/api/mcp`,
          headers: {
            Authorization: `Bearer ${args.token}`,
          },
        },
      },
    },
    null,
    2,
  );

  // Single-quoted heredoc terminators ('SDMCP_EOF', 'SDCTX_EOF') prevent
  // shell expansion inside the file bodies — token characters, $, and
  // backticks are all safe.
  return [
    "mkdir -p ~/.sciencedash/brain-chat",
    "cat > ~/.sciencedash/brain-chat/.mcp.json <<'SDMCP_EOF'",
    mcpConfig,
    "SDMCP_EOF",
    "cat > ~/.sciencedash/brain-chat/CHAT_CONTEXT.md <<'SDCTX_EOF'",
    args.primer,
    "SDCTX_EOF",
    "chmod 600 ~/.sciencedash/brain-chat/.mcp.json",
    "cd ~/.sciencedash/brain-chat",
    "tmux new -As sd-brain 'claude --continue --mcp-config .mcp.json --append-system-prompt \"$(cat CHAT_CONTEXT.md)\" 2>/dev/null || claude --mcp-config .mcp.json --append-system-prompt \"$(cat CHAT_CONTEXT.md)\"'",
  ].join("\n");
}
