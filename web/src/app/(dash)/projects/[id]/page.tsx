import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatUtc, daysAgoLabel, relativeDays } from "@/lib/format";
import { InlineField } from "@/components/InlineField";
import {
  patchProjectField,
  patchHypothesisField,
  setProjectStatus,
  setProjectNarrativeReadiness,
  toggleAiAutoReview,
  updateProjectTags,
  deleteProject,
  createHypothesis,
  setHypothesisVerdict,
  deleteHypothesis,
  createMetricDefinition,
  deleteMetricDefinition,
  createRun,
  deleteRun,
  addWandbSource,
  removeWandbSource,
  addRepoLink,
  removeRepoLink,
} from "@/lib/server/projectActions";
import { spawnPaperFromHypothesis } from "@/lib/server/paperActions";
import { createCheckIn } from "@/lib/server/checkInActions";
import { RunAiReviewButton } from "@/components/RunAiReviewButton";
import { ParetoScatter } from "@/components/ParetoScatter";
import { TagChips } from "@/components/TagChips";
import { StatusForm } from "@/components/StatusForm";
import {
  ProjectStatus,
  NarrativeReadiness,
  HypothesisVerdict,
} from "@/generated/prisma/client";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function ProjectDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const tab = asString(sp.tab) || "overview";

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      tags: true,
      wandbSources: { orderBy: { createdAt: "asc" } },
      repoLinks: { orderBy: { createdAt: "asc" } },
      hypotheses: {
        orderBy: { createdAt: "desc" },
        include: {
          runs: {
            orderBy: { endedAt: "desc" },
            include: { metrics: { include: { definition: true } } },
          },
        },
      },
      metricDefinitions: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      decisions: { orderBy: { at: "desc" }, take: 20 },
    },
  });
  if (!project) notFound();

  const spentByHyp = new Map<string, number>();
  for (const h of project.hypotheses) {
    spentByHyp.set(
      h.id,
      h.runs.reduce((acc, r) => acc + (r.computeGpuHours ?? 0), 0),
    );
  }

  const totalRuns = project.hypotheses.reduce((a, h) => a + h.runs.length, 0);
  const primaryMetric = project.metricDefinitions.find((d) => d.isPrimary);
  const lastRunAt = project.hypotheses
    .flatMap((h) => h.runs.map((r) => r.endedAt?.getTime() ?? 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const lastTouch = Math.max(
    project.updatedAt.getTime(),
    lastRunAt,
    project.decisions[0]?.at.getTime() ?? 0,
  );
  const staleDays = relativeDays(new Date(lastTouch));

  return (
    <div className="container">
      <header className="header">
        <div className="stackTight" style={{ flex: 1, minWidth: 0 }}>
          <div className="pageTitle projectTitleInline">
            <InlineField
              value={project.title}
              field="title"
              idForAction={project.id}
              action={patchProjectField}
              placeholder="Project title"
            />
          </div>
          <div className="rowWrap">
            <span className="pill pillMuted">{project.status}</span>
            {project.tags && project.tags.length > 0 ? (
              <>
                {project.tags.slice(0, 4).map((t) => (
                  <span key={t.id} className="pill">
                    <span style={{ color: "var(--accent)" }}>#{t.name}</span>
                  </span>
                ))}
                {project.tags.length > 4 ? (
                  <span className="pill pillMuted">+{project.tags.length - 4}</span>
                ) : null}
              </>
            ) : null}
            {project.aiAutoReviewEnabled ? (
              <span className="pill" title="AI auto-review on stall">AI auto</span>
            ) : null}
            <span className="muted small">
              Updated {formatUtc(project.updatedAt)} UTC ·{" "}
              {daysAgoLabel(new Date(lastTouch))}
              {staleDays >= 14 && project.status === "active" ? " · stalled" : ""}
            </span>
          </div>
        </div>
        <div className="row">
          <Link className="button buttonSecondary" href="/projects">
            Back
          </Link>
        </div>
      </header>

      <nav className="tabs">
        <Link
          href={`/projects/${project.id}?tab=overview`}
          className={`tab ${tab === "overview" ? "tabActive" : ""}`}
        >
          Overview
        </Link>
        <Link
          href={`/projects/${project.id}?tab=runs`}
          className={`tab ${tab === "runs" ? "tabActive" : ""}`}
        >
          Hypotheses &amp; Runs{" "}
          <span className="muted" style={{ fontSize: 11 }}>
            {project.hypotheses.length}·{totalRuns}
          </span>
        </Link>
        <Link
          href={`/projects/${project.id}?tab=activity`}
          className={`tab ${tab === "activity" ? "tabActive" : ""}`}
        >
          Activity
        </Link>
      </nav>

      {tab === "overview" ? (
        <div className="twoCol">
          <main className="stack">
            <div className="card">
              <h2 className="sectionTitle">Status</h2>
              <StatusForm
                action={setProjectStatus.bind(null, project.id)}
                currentStatus={project.status}
                statusOptions={Object.values(ProjectStatus)}
              />
              <p className="muted small" style={{ marginTop: 8 }}>
                Promotions are gated on §16.1 fields. Every change is logged as a Decision.
              </p>
            </div>

            <div className="card">
              <h2 className="sectionTitle">Description</h2>
              <InlineField
                value={project.description}
                field="description"
                idForAction={project.id}
                action={patchProjectField}
                placeholder="One-paragraph description."
                multiline
              />
            </div>

            <div className="card">
              <h2 className="sectionTitle">§16.1 fields</h2>
              <div className="stack">
                <Labeled label="Hypothesis">
                  <InlineField value={project.hypothesis} field="hypothesis" idForAction={project.id} action={patchProjectField} multiline />
                </Labeled>
                <Labeled label="Figures of merit">
                  <InlineField value={project.figuresOfMerit} field="figuresOfMerit" idForAction={project.id} action={patchProjectField} multiline />
                </Labeled>
                <Labeled label="Timeline">
                  <InlineField value={project.timeline} field="timeline" idForAction={project.id} action={patchProjectField} multiline />
                </Labeled>
                <Labeled label="Next steps">
                  <InlineField value={project.nextSteps} field="nextSteps" idForAction={project.id} action={patchProjectField} multiline />
                </Labeled>
                <Labeled label="Blockers">
                  <InlineField value={project.blockers} field="blockers" idForAction={project.id} action={patchProjectField} multiline />
                </Labeled>
              </div>
            </div>

            <div className="card">
              <h2 className="sectionTitle">Narrative readiness</h2>
              <form action={setProjectNarrativeReadiness.bind(null, project.id)} className="row">
                <select name="narrativeReadiness" defaultValue={project.narrativeReadiness}>
                  {Object.values(NarrativeReadiness).map((v) => (
                    <option key={v} value={v}>{v.replace("_", " ")}</option>
                  ))}
                </select>
                <button className="button" type="submit">Save</button>
              </form>
              <div style={{ marginTop: 10 }}>
                <Labeled label="Note">
                  <InlineField
                    value={project.narrativeReadinessNote}
                    field="narrativeReadinessNote"
                    idForAction={project.id}
                    action={patchProjectField}
                    multiline
                    placeholder="what's still needed before writing"
                  />
                </Labeled>
              </div>
            </div>

            <div className="card">
              <h2 className="sectionTitle">GitHub repos</h2>
              {project.repoLinks.length === 0 ? (
                <p className="muted small">No repos linked.</p>
              ) : (
                <ul className="stack" style={{ listStyle: "none" }}>
                  {project.repoLinks.map((r: AnyDef) => (
                    <li
                      key={r.id}
                      className="row"
                      style={{ justifyContent: "space-between", gap: 8 }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <a
                          className="link"
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            wordBreak: "break-all",
                            fontFamily: "var(--font-geist-mono)",
                            fontSize: 12,
                          }}
                        >
                          {r.label ?? r.url}
                        </a>
                        {r.cachedLastCommitSha ? (
                          <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                            last commit {r.cachedLastCommitSha.slice(0, 7)}
                            {r.cachedLastCommitAt
                              ? ` · ${daysAgoLabel(r.cachedLastCommitAt)}`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                      <form action={removeRepoLink.bind(null, r.id)}>
                        <button
                          type="submit"
                          className="button buttonSecondary"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                        >
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form
                action={addRepoLink.bind(null, project.id)}
                className="row"
                style={{ flexWrap: "wrap", gap: 10, marginTop: 12 }}
              >
                <div className="field" style={{ flex: "1 1 260px" }}>
                  <label>Repo URL</label>
                  <input
                    name="url"
                    placeholder="https://github.com/owner/repo"
                    required
                  />
                </div>
                <div className="field" style={{ minWidth: 160 }}>
                  <label>Label (optional)</label>
                  <input name="label" placeholder="main repo / fork / …" />
                </div>
                <button className="button" type="submit">
                  Add repo
                </button>
              </form>
            </div>

            <div className="card">
              <h2 className="sectionTitle">W&amp;B projects</h2>
              {project.wandbSources.length === 0 ? (
                <p className="muted small">No W&amp;B projects linked.</p>
              ) : (
                <ul className="stack" style={{ listStyle: "none" }}>
                  {project.wandbSources.map((s: AnyDef) => (
                    <li
                      key={s.id}
                      className="row"
                      style={{ justifyContent: "space-between", gap: 8 }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-geist-mono)",
                          fontSize: 12,
                        }}
                      >
                        {s.entity}
                        <span className="muted"> / </span>
                        {s.name}
                      </div>
                      <form action={removeWandbSource.bind(null, s.id)}>
                        <button
                          type="submit"
                          className="button buttonSecondary"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                        >
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form
                action={addWandbSource.bind(null, project.id)}
                className="row"
                style={{ flexWrap: "wrap", gap: 10, marginTop: 12 }}
              >
                <div className="field" style={{ minWidth: 160 }}>
                  <label>W&amp;B entity</label>
                  <input name="entity" placeholder="murnanedaniel" required />
                </div>
                <div className="field" style={{ flex: "1 1 200px" }}>
                  <label>W&amp;B project</label>
                  <input name="name" placeholder="collider-tracking" required />
                </div>
                <button className="button" type="submit">
                  Add W&amp;B project
                </button>
              </form>
              <p className="muted small" style={{ marginTop: 8 }}>
                Runs can then be linked to any of these sources via their
                Log-a-run form.
              </p>
            </div>

            <div className="card">
              <h2 className="sectionTitle">Tags</h2>
              <form action={updateProjectTags.bind(null, project.id)} className="stack">
                <TagChips
                  name="tags"
                  initial={project.tags.map((t: AnyDef) => t.name).join(", ")}
                  placeholder="tracking, hl-lhc, ingredient"
                />
                <button className="button" type="submit" style={{ width: "fit-content" }}>
                  Save tags
                </button>
              </form>
              {project.tags.length ? (
                <div className="rowWrap" style={{ marginTop: 10 }}>
                  {project.tags.map((t: AnyDef) => (
                    <Link key={t.id} className="pill" href={`/projects?tags=${encodeURIComponent(t.name)}`}>#{t.name}</Link>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="card">
              <h2 className="sectionTitle">Primary metric</h2>
              {primaryMetric ? (
                <div className="muted">
                  <strong>{primaryMetric.name}</strong>
                  {primaryMetric.unit ? ` (${primaryMetric.unit})` : ""} —{" "}
                  {primaryMetric.direction === "higher" ? "higher is better" : "lower is better"}
                  {primaryMetric.threshold != null ? ` · threshold ${primaryMetric.threshold}` : ""}
                </div>
              ) : (
                <p className="muted small">
                  No primary metric declared yet. Add one under Hypotheses &amp; Runs → metric definitions.
                </p>
              )}
            </div>

            <div className="card">
              <h2 className="sectionTitle">AI critical review</h2>
              <p className="muted small" style={{ marginBottom: 10 }}>
                §16.6 — critical, not polite. Returns actionable patches you accept one-by-one.
              </p>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <RunAiReviewButton projectId={project.id} />
                <form action={toggleAiAutoReview.bind(null, project.id)}>
                  <button className="button buttonSecondary" type="submit">
                    {project.aiAutoReviewEnabled
                      ? "Disable AI auto-review on stall"
                      : "Enable AI auto-review on stall"}
                  </button>
                </form>
              </div>
            </div>

            <div className="card danger">
              <h2 className="sectionTitle">Danger zone</h2>
              <form action={deleteProject.bind(null, project.id)}>
                <button className="button buttonDanger" type="submit">Delete project</button>
              </form>
            </div>
          </main>

          <aside className="rail">
            <div className="railItem">
              <time>Snapshot</time>
              Hypotheses {project.hypotheses.length} · Runs {totalRuns} · Metrics {project.metricDefinitions.length}
            </div>
            <div className="railItem">
              <time>New check-in</time>
              <form
                action={createCheckIn.bind(null, { scope: "project" as const, scopeId: project.id })}
                className="stackTight"
              >
                <textarea name="bodyMd" rows={3} placeholder="what happened today" />
                <button type="submit" className="button">Log</button>
              </form>
            </div>
            <div className="railItem">
              <time>Recent activity</time>
              {project.decisions.length === 0 ? (
                <div className="muted">No decisions yet.</div>
              ) : (
                <ul className="stackTight" style={{ listStyle: "none" }}>
                  {project.decisions.slice(0, 5).map((d) => (
                    <li key={d.id} className="small">
                      <span className="muted">{daysAgoLabel(d.at)}</span> ·{" "}
                      <strong>{d.kind.replace("_", " ")}</strong>
                      {d.rationale ? ` — ${d.rationale}` : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : tab === "runs" ? (
        <RunsTab project={project} spentByHyp={spentByHyp} />
      ) : (
        <ActivityTab projectId={project.id} />
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

async function ActivityTab({ projectId }: { projectId: string }) {
  const decisions = await prisma.decision.findMany({
    where: { projectId },
    orderBy: { at: "desc" },
    take: 200,
  });
  const runs = await prisma.run.findMany({
    where: { hypothesis: { projectId } },
    orderBy: { endedAt: "desc" },
    include: { hypothesis: true },
    take: 200,
  });
  const checkIns = await prisma.checkIn.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  type Row = { at: Date; kind: string; title: string; sub?: string };
  const rows: Row[] = [
    ...decisions.map((d) => ({
      at: d.at,
      kind: d.kind,
      title: d.rationale ?? d.kind,
      sub: `decision · ${d.subjectType}`,
    })),
    ...runs.map((r) => ({
      at: r.endedAt ?? r.createdAt,
      kind: "run",
      title: `run: ${r.name}`,
      sub: `hypothesis: ${r.hypothesis.title}`,
    })),
    ...checkIns.map((c) => ({
      at: c.createdAt,
      kind: c.source === "ai" ? "ai-review" : "check-in",
      title: c.bodyMd.slice(0, 240),
      sub: c.source,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  if (rows.length === 0) {
    return <div className="card muted">No activity yet.</div>;
  }

  return (
    <div className="activity">
      {rows.map((r, i) => (
        <div key={i} className="activityRow">
          <time>{formatUtc(r.at)}</time>
          <div>
            <strong>{r.kind.replace("_", " ")}</strong>
            {r.sub ? <span className="muted small"> · {r.sub}</span> : null}
            <div style={{ marginTop: 4 }}>{r.title}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDef = any;
type AnyHyp = any;

function RunsTab({
  project,
  spentByHyp,
}: {
  project: any;
  spentByHyp: Map<string, number>;
}) {
  // Build Pareto points
  type Point = { id: string; label: string; metrics: Record<string, number> };
  const points: Point[] = project.hypotheses.flatMap((h: AnyHyp) =>
    h.runs.map((r: AnyDef) => ({
      id: r.id,
      label: `${h.title}/${r.name}`,
      metrics: Object.fromEntries(
        r.metrics.map((m: AnyDef) => {
          const def = project.metricDefinitions.find(
            (d: AnyDef) => d.id === m.definitionId,
          );
          return [def?.name ?? "unknown", m.value];
        }),
      ),
    })),
  );
  const metricsForPareto = project.metricDefinitions.map((d: AnyDef) => ({
    name: d.name,
    unit: d.unit,
    direction: d.direction,
  }));

  return (
    <div className="stack">
      {points.length >= 2 && metricsForPareto.length >= 2 ? (
        <div className="card">
          <h2 className="sectionTitle">Pareto scatter</h2>
          <ParetoScatter points={points} metrics={metricsForPareto} />
        </div>
      ) : null}
      <div className="card">
        <h2 className="sectionTitle">Metric definitions</h2>
        {project.metricDefinitions.length === 0 ? (
          <p className="muted small">
            No metrics yet. Declare at least one (primary) to enable run metric entry and promotion.
          </p>
        ) : (
          <table className="metricTable" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Unit</th>
                <th>Direction</th>
                <th className="num">Threshold</th>
                <th>Primary</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {project.metricDefinitions.map((m: AnyDef) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.unit ?? "—"}</td>
                  <td>{m.direction}</td>
                  <td className="num">{m.threshold ?? "—"}</td>
                  <td>{m.isPrimary ? "✓" : ""}</td>
                  <td>
                    <form action={deleteMetricDefinition.bind(null, m.id)}>
                      <button className="button buttonSecondary" type="submit" style={{ padding: "4px 8px", fontSize: 12 }}>Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={createMetricDefinition.bind(null, project.id)} className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="field" style={{ minWidth: 160 }}>
            <label>Name</label>
            <input name="name" placeholder="e.g. tracking efficiency" required />
          </div>
          <div className="field" style={{ minWidth: 120 }}>
            <label>Unit</label>
            <input name="unit" placeholder="%, GB, AUC" />
          </div>
          <div className="field" style={{ minWidth: 120 }}>
            <label>Direction</label>
            <select name="direction" defaultValue="higher">
              <option value="higher">higher</option>
              <option value="lower">lower</option>
            </select>
          </div>
          <div className="field" style={{ minWidth: 120 }}>
            <label>Threshold</label>
            <input name="threshold" type="number" step="any" />
          </div>
          <div className="field" style={{ minWidth: 120 }}>
            <label>
              <input type="checkbox" name="isPrimary" style={{ width: "auto", marginRight: 6 }} />
              Primary
            </label>
          </div>
          <button className="button" type="submit">Add metric</button>
        </form>
      </div>

      <div className="card">
        <h2 className="sectionTitle">New hypothesis</h2>
        <form action={createHypothesis.bind(null, project.id)} className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="field" style={{ flex: "1 1 240px" }}>
            <label>Title</label>
            <input name="title" placeholder="e.g. block-sparse attention helps tracking" required />
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label>Budget (GPU-h)</label>
            <input type="number" step="any" name="computeBudgetGpuHours" defaultValue={10} />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label>Statement</label>
            <textarea name="statement" rows={2} placeholder="if X then Y because Z" />
          </div>
          <button className="button" type="submit">Add hypothesis</button>
        </form>
      </div>

      {project.hypotheses.length === 0 ? (
        <div className="card muted small">
          No hypotheses yet. Add one above — then log runs against it.
        </div>
      ) : (
        project.hypotheses.map((h: AnyHyp) => {
          const spent = spentByHyp.get(h.id) ?? 0;
          const pct = Math.min(100, (spent / Math.max(h.computeBudgetGpuHours, 0.01)) * 100);
          const over = spent > h.computeBudgetGpuHours;
          return (
            <div key={h.id} className="hypCard">
              <div className="hypHeader">
                <div style={{ flex: 1 }}>
                  <div className="hypTitle">
                    <InlineField value={h.title} field="title" idForAction={h.id} action={patchHypothesisField} />
                  </div>
                  <div className="rowWrap" style={{ marginTop: 6 }}>
                    <span className="pill pillMuted">{h.status}</span>
                    <span className="pill">verdict: {h.verdict}</span>
                  </div>
                </div>
                <form action={deleteHypothesis.bind(null, h.id)}>
                  <button className="button buttonSecondary" type="submit">Delete</button>
                </form>
              </div>

              <div>
                <div className="muted small" style={{ marginBottom: 4 }}>
                  Compute budget · {spent.toFixed(1)} / {h.computeBudgetGpuHours} GPU-h
                  {over ? " · escalate?" : ""}
                </div>
                <div className="meter">
                  <div className={`meterFill ${over ? "over" : ""}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
              </div>

              <div>
                <label className="muted small">Statement</label>
                <InlineField value={h.statement} field="statement" idForAction={h.id} action={patchHypothesisField} multiline placeholder="if X then Y because Z" />
              </div>

              {h.runs.length === 0 ? (
                <p className="muted small">No runs yet.</p>
              ) : (
                <table className="metricTable">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Ended</th>
                      <th className="num">GPU-h</th>
                      {project.metricDefinitions.map((d: AnyDef) => (
                        <th key={d.id} className="num">
                          {d.name}{d.unit ? ` (${d.unit})` : ""}
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.runs.map((r: AnyDef) => (
                      <tr key={r.id}>
                        <td>
                          <div>{r.name}</div>
                          {r.wandbRunId ? (<div className="muted" style={{ fontSize: 10 }}>wandb: {r.wandbRunId}</div>) : null}
                        </td>
                        <td>{r.endedAt ? formatUtc(r.endedAt) : "—"}</td>
                        <td className="num">{r.computeGpuHours.toFixed(1)}</td>
                        {project.metricDefinitions.map((d: AnyDef) => {
                          const m = r.metrics.find((x: AnyDef) => x.definitionId === d.id);
                          return (<td key={d.id} className="num">{m ? m.value : "—"}</td>);
                        })}
                        <td>
                          <form action={deleteRun.bind(null, r.id)}>
                            <button className="button buttonSecondary" type="submit" style={{ padding: "4px 8px", fontSize: 12 }}>Delete</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <details>
                <summary className="muted small" style={{ cursor: "pointer" }}>Log a run</summary>
                <form action={createRun.bind(null, h.id)} className="row" style={{ flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                  <div className="field" style={{ flex: "1 1 200px" }}>
                    <label>Run name</label>
                    <input name="name" required placeholder="e.g. run-2026-04-23-a" />
                  </div>
                  <div className="field" style={{ minWidth: 120 }}>
                    <label>GPU-h</label>
                    <input name="computeGpuHours" type="number" step="any" defaultValue={0} />
                  </div>
                  <div className="field" style={{ minWidth: 140 }}>
                    <label>W&amp;B run id</label>
                    <input name="wandbRunId" placeholder="optional" />
                  </div>
                  {project.wandbSources.length > 0 ? (
                    <div className="field" style={{ minWidth: 180 }}>
                      <label>W&amp;B source</label>
                      <select name="wandbSourceId" defaultValue="">
                        <option value="">(none)</option>
                        {project.wandbSources.map((s: AnyDef) => (
                          <option key={s.id} value={s.id}>
                            {s.entity}/{s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div className="field" style={{ minWidth: 160 }}>
                    <label>Ended at</label>
                    <input name="endedAt" type="datetime-local" />
                  </div>
                  {project.metricDefinitions.map((d: AnyDef) => (
                    <div key={d.id} className="field" style={{ minWidth: 120 }}>
                      <label>{d.name}{d.isPrimary ? " ★" : ""}</label>
                      <input name={`metric:${d.id}`} type="number" step="any" />
                    </div>
                  ))}
                  <div className="field" style={{ flex: "1 1 100%" }}>
                    <label>Notes</label>
                    <input name="notes" placeholder="optional" />
                  </div>
                  <button className="button" type="submit">Save run</button>
                </form>
              </details>

              <details>
                <summary className="muted small" style={{ cursor: "pointer" }}>Resolve hypothesis</summary>
                <form action={setHypothesisVerdict.bind(null, h.id)} className="row" style={{ marginTop: 10 }}>
                  <select name="verdict" defaultValue={h.verdict}>
                    {Object.values(HypothesisVerdict).map((v) => (
                      <option key={v} value={v}>{v.replace("_", " ")}</option>
                    ))}
                  </select>
                  <input name="status" type="hidden" value="resolved" />
                  <button className="button" type="submit">Mark resolved</button>
                </form>
              </details>

              <form action={spawnPaperFromHypothesis.bind(null, h.id)}>
                <button type="submit" className="button" style={{ width: "fit-content" }}>
                  Spawn paper →
                </button>
              </form>
            </div>
          );
        })
      )}
    </div>
  );
}
