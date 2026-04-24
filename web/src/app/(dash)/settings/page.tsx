import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatUtc, daysAgoLabel } from "@/lib/format";
import { RunJobButton } from "@/components/RunJobButton";
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
  };

  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, aiAutoReviewEnabled: true, status: true },
  });

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Settings</h1>
        <p className="pageSub">Integrations, worker health, prompts, AI auto-review.</p>
      </header>

      <div className="stack">
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
                  </tr>
                ))}
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
          <table className="metricTable">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Status</th>
                <th>Payload / error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 30).map((j) => (
                <tr key={j.id}>
                  <td>{j.kind}</td>
                  <td>{formatUtc(j.startedAt)}</td>
                  <td>{j.endedAt ? formatUtc(j.endedAt) : "—"}</td>
                  <td>{j.ok === true ? "✓" : j.ok === false ? "✗" : "queued"}</td>
                  <td style={{ fontSize: 11 }}>
                    {j.error ? j.error : j.payloadJson ?? ""}
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
