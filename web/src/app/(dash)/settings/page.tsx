import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatUtc, daysAgoLabel } from "@/lib/format";
import { RunJobButton } from "@/components/RunJobButton";
import { CopyButton } from "@/components/CopyButton";
import { DeployStatusWidget } from "@/components/DeployStatusWidget";
import {
  upsertPromptTemplate,
  resetPromptTemplate,
  loadDefaultPrompt,
} from "@/lib/server/settingsActions";
import { toggleAiAutoReview } from "@/lib/server/projectActions";
import { detectClaudeCode } from "@/lib/ai/client";
import { PromptKind } from "@/generated/prisma/client";

const PROMPT_LABELS: Record<PromptKind, string> = {
  critical_review: "Critical review",
  paper_skeleton: "Paper skeleton",
  section_polish: "Section polish",
  outer_loop_audit: "Outer-loop audit",
  repo_quickstart: "Repo quickstart",
  literature_review: "Literature review",
  project_brain: "Project brain",
};

export default async function SettingsPage() {
  const jobs = await prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 60,
  });
  const latestByKind = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    if (!latestByKind.has(j.kind)) latestByKind.set(j.kind, j);
  }
  const heartbeat = jobs.find((j) => j.kind === "other" && j.ok === true);

  const claudeCode = await detectClaudeCode();
  const keys = {
    WANDB_API_KEY: !!process.env.WANDB_API_KEY,
    GITHUB_PAT: !!process.env.GITHUB_PAT,
  };

  const templates = await prisma.promptTemplate.findMany();
  const templatesByKind = new Map(templates.map((t) => [t.kind, t]));

  const defaultPrompts: Record<PromptKind, string> = {
    critical_review: await loadDefaultPrompt("critical_review"),
    paper_skeleton: await loadDefaultPrompt("paper_skeleton"),
    section_polish: await loadDefaultPrompt("section_polish"),
    outer_loop_audit: await loadDefaultPrompt("outer_loop_audit"),
    repo_quickstart: await loadDefaultPrompt("repo_quickstart"),
    literature_review: await loadDefaultPrompt("literature_review"),
    project_brain: await loadDefaultPrompt("project_brain"),
  };

  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      aiAutoReviewEnabled: true,
      status: true,
      autonomyJson: true,
      brainIntervalSec: true,
      workhorseIntervalSec: true,
      brainLastHeartbeatAt: true,
    },
  });

  // 7-day cost & silence stats for each project's brain heartbeat. We
  // compute this as one batched query and bucket on the client to avoid
  // N+1 round-trips.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentBrainRuns = await prisma.jobRun.findMany({
    where: {
      kind: "project_brain",
      startedAt: { gte: sevenDaysAgo },
      ok: true, // only completed runs count toward cost / silence
    },
    select: {
      projectId: true,
      costUsd: true,
      payloadJson: true,
    },
  });
  type ProjectStats = {
    cycles: number;
    costUsd: number;
    silentCycles: number; // cycles that posted 0 messages
  };
  const statsByProject = new Map<string, ProjectStats>();
  for (const r of recentBrainRuns) {
    if (!r.projectId) continue;
    const cur = statsByProject.get(r.projectId) ?? {
      cycles: 0,
      costUsd: 0,
      silentCycles: 0,
    };
    cur.cycles += 1;
    cur.costUsd += r.costUsd ?? 0;
    let messagesPosted = 0;
    try {
      const parsed = r.payloadJson ? JSON.parse(r.payloadJson) : null;
      if (parsed && typeof parsed.messagesPosted === "number") {
        messagesPosted = parsed.messagesPosted;
      }
    } catch {
      // ignore
    }
    if (messagesPosted === 0) cur.silentCycles += 1;
    statsByProject.set(r.projectId, cur);
  }

  // For each project, derive the autonomy bucket of brain_heartbeat /
  // workhorse_tick from the autonomyJson + label the cadence override.
  type ParsedAutonomy = { auto: string[]; propose: string[]; ask: string[] };
  function parseBuckets(json: string | null): ParsedAutonomy {
    if (!json) return { auto: [], propose: [], ask: [] };
    try {
      const p = JSON.parse(json) as Partial<ParsedAutonomy>;
      return {
        auto: Array.isArray(p.auto) ? p.auto : [],
        propose: Array.isArray(p.propose) ? p.propose : [],
        ask: Array.isArray(p.ask) ? p.ask : [],
      };
    } catch {
      return { auto: [], propose: [], ask: [] };
    }
  }
  function bucketOf(buckets: ParsedAutonomy, name: string): "auto" | "propose" | "ask" {
    if (buckets.auto.includes(name)) return "auto";
    if (buckets.propose.includes(name)) return "propose";
    return "ask";
  }
  function cadenceLabel(intervalSec: number | null): string {
    if (intervalSec === null) return "default";
    if (intervalSec === 0) return "paused";
    if (intervalSec < 3600) return `${Math.round(intervalSec / 60)}m`;
    return `${Math.round(intervalSec / 3600)}h`;
  }

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Settings</h1>
        <p className="pageSub">Integrations, worker health, prompts, AI auto-review.</p>
      </header>

      <div className="stack">
        <DeployStatusWidget />

        {/* Integrations */}
        <div className="card">
          <h2 className="sectionTitle">Integrations</h2>
          <ul className="stack" style={{ listStyle: "none" }}>
            <li className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <code style={{ fontFamily: "var(--font-geist-mono)" }}>
                  Claude Code
                </code>
                <div className="muted small" style={{ marginTop: 2 }}>
                  AI features bill against your Pro / Max subscription, not API credits.
                  Requires <code>claude</code> on PATH and logged in (<code>claude login</code>).
                </div>
              </div>
              <span
                className="pill"
                style={{
                  color: claudeCode.ok ? "var(--accent)" : "var(--faint)",
                  whiteSpace: "nowrap",
                }}
                title={claudeCode.error}
              >
                {claudeCode.ok
                  ? claudeCode.version ?? "detected"
                  : "missing"}
              </span>
            </li>
            {Object.entries(keys).map(([k, ok]) => (
              <li
                key={k}
                className="row"
                style={{ justifyContent: "space-between" }}
              >
                <code style={{ fontFamily: "var(--font-geist-mono)" }}>{k}</code>
                <span
                  className="pill"
                  style={{ color: ok ? "var(--accent)" : "var(--faint)" }}
                >
                  {ok ? "configured" : "missing"}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 8 }}>
            Restart the server after editing <code>.env.local</code>. Claude Code auth
            is stored in <code>~/.claude/</code> — no env var needed.
          </p>
        </div>

        {/* Cluster integration */}
        <div className="card">
          <h2 className="sectionTitle">Cluster Claude integration</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Hook a long-running Claude Code session on a remote host (Perlmutter, Vast, …) into ScienceDash via the workhorse sync protocol.
          </p>
          <ol className="stack small" style={{ paddingLeft: 18, gap: 10 }}>
            <li>
              <div>
                <strong>One-time:</strong> install <code>cloudflared</code> on the laptop (Linux/WSL2):
              </div>
              <ClusterCmd cmd="curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i /tmp/cloudflared.deb" />
            </li>
            <li>
              <div>
                Open a fresh laptop terminal and start a quick-tunnel — keep it running for the whole work session:
              </div>
              <ClusterCmd cmd="cloudflared tunnel --url http://localhost:3000" />
              <div className="muted small" style={{ marginTop: 4 }}>
                Copy the printed <code>https://*.trycloudflare.com</code> URL — that&apos;s your dashboard URL for the cluster side.
              </div>
            </li>
            <li>
              <div>SSH into the cluster:</div>
              <ClusterCmd cmd="ssh user@host" />
            </li>
            <li>
              <div>Copy the bootstrap files to the cluster:</div>
              <ClusterCmd cmd="scp tools/workhorse-bootstrap/sync.py tools/workhorse-bootstrap/setup.sh user@host:~/.sciencedash-bootstrap/" />
            </li>
            <li>
              <div>Run the bootstrap on the cluster (paste the cloudflared URL):</div>
              <ClusterCmd cmd="DASHBOARD=https://<your-cloudflared-url> HOST=<host> bash ~/.sciencedash-bootstrap/setup.sh" />
            </li>
            <li>
              Edit <code>~/.sciencedash/config.json</code> to register projects (set <code>dashboard_url</code> to the same cloudflared URL), then re-run setup.sh (it&apos;s idempotent and generates per-project MCP configs).
            </li>
            <li>
              <div>Start the Claude session inside tmux:</div>
              <ClusterCmd cmd="tmux new -As sd-<projectId> &quot;cd <repo> && claude --mcp-config ~/.sciencedash/<projectId>/mcp-config.json&quot;" />
            </li>
            <li>
              <div>Re-attach later (optional):</div>
              <ClusterCmd cmd="tmux attach -t sd-<projectId>" />
            </li>
          </ol>
          <p className="muted small" style={{ marginTop: 8 }}>
            Full guide: <Link className="link" href="/docs/setup">/docs/setup</Link>{" "}
            (cloudflared + SSH-tunnel alternative). Wire protocol:{" "}
            <code>docs/workhorse-protocol.md</code>.
          </p>
        </div>

        {/* Worker */}
        <div className="card">
          <h2 className="sectionTitle">Background worker</h2>
          <div className="row" style={{ gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <RunJobButton kind="wandb_pull" label="Pull W&B now" />
            <RunJobButton kind="github_pull" label="Pull GitHub now" />
            <RunJobButton kind="stall_detect" label="Run stall detect now" />
          </div>
          <div className="muted small">
            {heartbeat ? (
              <>
                Heartbeat · last {daysAgoLabel(heartbeat.startedAt)} ({formatUtc(heartbeat.startedAt)} UTC)
              </>
            ) : (
              "No heartbeat yet — the worker boots a few seconds after the server starts."
            )}
          </div>

          <h3 className="sectionTitle" style={{ marginTop: 14 }}>Last run per kind</h3>
          <table className="metricTable">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Started</th>
                <th>Status</th>
                <th>Payload / error</th>
                <th>Trace</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(latestByKind.entries())
                .filter(([k]) => k !== "other")
                .map(([k, j]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{formatUtc(j.startedAt)}</td>
                    <td>
                      {j.ok === true ? "✓" : j.ok === false ? "✗" : "queued"}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {j.error ? j.error : j.payloadJson ?? ""}
                    </td>
                    <td>
                      <Link className="link small" href={`/jobs/${j.id}`}>view →</Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Autonomy loops per project */}
        <div className="card">
          <h2 className="sectionTitle">Autonomy loops (per project)</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>
            Two scheduled loops control how the brain and workhorses
            self-drive. Default cadence: brain 12h, workhorse 1h. Toggle
            buckets and tempo on each project&apos;s Overview tab. Cycles
            and cost columns cover the last 7 days.
          </p>
          <table style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  Project
                </th>
                <th style={{ textAlign: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  Brain
                </th>
                <th style={{ textAlign: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  Workhorse
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  Cycles 7d
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  Cost 7d
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  Silent
                </th>
                <th style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                  Last brain
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const buckets = parseBuckets(p.autonomyJson);
                const brainBucket = bucketOf(buckets, "brain_heartbeat");
                const workhorseBucket = bucketOf(buckets, "workhorse_tick");
                const stats = statsByProject.get(p.id) ?? {
                  cycles: 0,
                  costUsd: 0,
                  silentCycles: 0,
                };
                const silentRatio = stats.cycles > 0 ? stats.silentCycles / stats.cycles : null;
                return (
                  <tr key={p.id}>
                    <td style={{ padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                      <Link className="link" href={`/projects/${p.id}`}>
                        {p.title}
                      </Link>
                      <span className="muted small"> · {p.status}</span>
                    </td>
                    <td style={{ textAlign: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                      <span className="muted small">{brainBucket}</span>
                      <span style={{ margin: "0 4px", color: "var(--faint)" }}>·</span>
                      <code style={{ fontSize: 11 }}>{cadenceLabel(p.brainIntervalSec)}</code>
                    </td>
                    <td style={{ textAlign: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                      <span className="muted small">{workhorseBucket}</span>
                      <span style={{ margin: "0 4px", color: "var(--faint)" }}>·</span>
                      <code style={{ fontSize: 11 }}>{cadenceLabel(p.workhorseIntervalSec)}</code>
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                      {stats.cycles}
                    </td>
                    <td style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                      ${stats.costUsd.toFixed(2)}
                    </td>
                    <td
                      className="muted small"
                      style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}
                    >
                      {silentRatio === null
                        ? "–"
                        : `${stats.silentCycles}/${stats.cycles}`}
                    </td>
                    <td
                      className="muted small"
                      style={{ textAlign: "right", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}
                    >
                      {p.brainLastHeartbeatAt
                        ? daysAgoLabel(p.brainLastHeartbeatAt)
                        : "never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* AI auto-review per project */}
        <div className="card">
          <h2 className="sectionTitle">AI auto-review (per project)</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>
            When enabled, stalled projects get a critical AI review automatically (writes a CheckIn you triage on /today).
            Disabled projects queue a JobRun you consume with one click.
          </p>
          <ul className="stack" style={{ listStyle: "none" }}>
            {projects.map((p) => (
              <li
                key={p.id}
                className="row"
                style={{ justifyContent: "space-between", padding: "6px 0" }}
              >
                <div>
                  <Link className="link" href={`/projects/${p.id}`}>
                    {p.title}
                  </Link>
                  <span className="muted small"> · {p.status}</span>
                </div>
                <form action={toggleAiAutoReview.bind(null, p.id)}>
                  <button
                    type="submit"
                    className="button buttonSecondary"
                    style={{ padding: "4px 8px", fontSize: 12 }}
                  >
                    {p.aiAutoReviewEnabled ? "auto ✓ — turn off" : "turn on"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>

        {/* Prompt templates */}
        <div className="card">
          <h2 className="sectionTitle">Prompt templates</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>
            Override the default prompt for any AI kind. Leave blank to use the on-disk default (shown below).
          </p>
          {Object.values(PromptKind).map((kind) => {
            const t = templatesByKind.get(kind);
            return (
              <details key={kind} style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer" }}>
                  <strong>{PROMPT_LABELS[kind]}</strong>{" "}
                  {t ? <span className="pill">customized · v{t.version}</span> : <span className="muted small">(default)</span>}
                </summary>
                <form action={upsertPromptTemplate.bind(null, kind)} className="stack" style={{ marginTop: 10 }}>
                  <textarea
                    name="bodyMd"
                    rows={12}
                    defaultValue={t?.bodyMd ?? defaultPrompts[kind]}
                    style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12 }}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="button" type="submit">Save</button>
                    {t ? (
                      <form action={resetPromptTemplate.bind(null, kind)}>
                        <button className="button buttonSecondary" type="submit">Reset to default</button>
                      </form>
                    ) : null}
                  </div>
                </form>
              </details>
            );
          })}
        </div>

        {/* Recent jobs */}
        <div className="card">
          <h2 className="sectionTitle">Recent jobs</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>
            Click <em>view</em> on any row to see the Claude session&apos;s live trace (assistant messages, tool calls, tool results).
          </p>
          <table className="metricTable">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Title</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Status</th>
                <th className="num">Cost</th>
                <th>Trace</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 30).map((j) => (
                <tr key={j.id}>
                  <td>{j.kind}</td>
                  <td style={{ fontSize: 12 }}>{j.title ?? ""}</td>
                  <td>{formatUtc(j.startedAt)}</td>
                  <td>{j.endedAt ? formatUtc(j.endedAt) : "—"}</td>
                  <td>{j.ok === true ? "✓" : j.ok === false ? "✗" : "queued"}</td>
                  <td className="num">
                    {typeof j.costUsd === "number" ? `$${j.costUsd.toFixed(3)}` : "—"}
                  </td>
                  <td>
                    <Link className="link small" href={`/jobs/${j.id}`}>view →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** A code-block row with a sticky Copy button — used in the cluster recipe. */
function ClusterCmd({ cmd }: { cmd: string }) {
  return (
    <div
      className="row"
      style={{
        marginTop: 4,
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <code style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12 }}>{cmd}</code>
      <CopyButton value={cmd} label="Copy" />
    </div>
  );
}
