/**
 * Autonomy editor — sets per-project Project.autonomyJson.
 *
 * Server component. The form serializes its inputs into a JSON blob
 * that setAutonomyAction validates and persists. Listed action classes
 * come from KNOWN_ACTION_CLASSES; the user can also write a custom
 * action class name to one of the buckets via a free-form input.
 */

import { setAutonomyAction } from "@/lib/server/autonomyActions";
import {
  KNOWN_ACTION_CLASSES,
  DEFAULT_AUTONOMY,
  type AutonomyConfig,
} from "@/lib/brain/autonomy";
import {
  DEFAULT_BRAIN_INTERVAL_SEC,
  DEFAULT_WORKHORSE_INTERVAL_SEC,
} from "@/lib/worker";

type Props = {
  projectId: string;
  autonomyJson: string | null;
  brainIntervalSec: number | null;
  workhorseIntervalSec: number | null;
};

// Cadence options offered in the dropdowns. Values in seconds. 0 = paused;
// "" (empty string) = use the worker's global default.
const BRAIN_CADENCE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Default (12h)", value: "" },
  { label: "Paused", value: "0" },
  { label: "1h", value: String(1 * 3600) },
  { label: "6h", value: String(6 * 3600) },
  { label: "12h", value: String(12 * 3600) },
  { label: "24h", value: String(24 * 3600) },
];
const WORKHORSE_CADENCE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Default (1h)", value: "" },
  { label: "Paused", value: "0" },
  { label: "30m", value: String(30 * 60) },
  { label: "1h", value: String(1 * 3600) },
  { label: "6h", value: String(6 * 3600) },
  { label: "12h", value: String(12 * 3600) },
  { label: "24h", value: String(24 * 3600) },
];

const RISK_COLORS: Record<string, string> = {
  low: "var(--accent, #2a8c4a)",
  medium: "var(--accent2, #b08a3a)",
  high: "var(--red, #c0322a)",
};

function parseAutonomy(autonomyJson: string | null): AutonomyConfig {
  if (!autonomyJson) return DEFAULT_AUTONOMY;
  try {
    const parsed = JSON.parse(autonomyJson) as Partial<AutonomyConfig>;
    return {
      auto: Array.isArray(parsed.auto) ? parsed.auto : [],
      propose: Array.isArray(parsed.propose) ? parsed.propose : [],
      ask: Array.isArray(parsed.ask) ? parsed.ask : [],
      spendCapGpuH:
        typeof parsed.spendCapGpuH === "number"
          ? parsed.spendCapGpuH
          : DEFAULT_AUTONOMY.spendCapGpuH,
      spendCapTokensUsd:
        typeof parsed.spendCapTokensUsd === "number"
          ? parsed.spendCapTokensUsd
          : DEFAULT_AUTONOMY.spendCapTokensUsd,
    };
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

function classBucket(cfg: AutonomyConfig, name: string): "auto" | "propose" | "ask" {
  if (cfg.auto.includes(name)) return "auto";
  if (cfg.propose.includes(name)) return "propose";
  return "ask";
}

export function AutonomyEditor({
  projectId,
  autonomyJson,
  brainIntervalSec,
  workhorseIntervalSec,
}: Props) {
  const cfg = parseAutonomy(autonomyJson);
  // Render the dropdown's `defaultValue` as the matching option string,
  // or "" (which represents the global-default option) if the project's
  // override is null.
  const brainSelectValue =
    brainIntervalSec === null ? "" : String(brainIntervalSec);
  const workhorseSelectValue =
    workhorseIntervalSec === null ? "" : String(workhorseIntervalSec);

  // Surface any custom (non-known) classes the user has added so they
  // don't get silently dropped on save.
  const knownNames = new Set(KNOWN_ACTION_CLASSES.map((c) => c.name));
  const customNames = Array.from(
    new Set([...cfg.auto, ...cfg.propose, ...cfg.ask].filter((n) => !knownNames.has(n))),
  );

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <h2 className="sectionTitle" style={{ margin: 0 }}>
          Autonomy
        </h2>
        <span className="muted small">
          {cfg.auto.length} auto · {cfg.propose.length} propose · default ask
        </span>
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>
        What the brain may dispatch on its own. Default: everything asks.
        Promote action classes to <strong>propose</strong> (fires with a
        cancel-grace window) or <strong>auto</strong> (fires immediately,
        logs after) once you trust them.
      </p>

      <form action={setAutonomyAction} style={{ marginTop: 10 }}>
        <input type="hidden" name="projectId" value={projectId} />

        <table className="autonomyTable" style={{ width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                Action class
              </th>
              <th style={{ textAlign: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)", width: 70 }}>
                Ask
              </th>
              <th style={{ textAlign: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)", width: 80 }}>
                Propose
              </th>
              <th style={{ textAlign: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)", width: 70 }}>
                Auto
              </th>
            </tr>
          </thead>
          <tbody>
            {KNOWN_ACTION_CLASSES.map((c) => (
              <ActionRow
                key={c.name}
                name={c.name}
                description={c.description}
                riskLevel={c.riskLevel}
                current={classBucket(cfg, c.name)}
              />
            ))}
            {customNames.map((name) => (
              <ActionRow
                key={name}
                name={name}
                description="(custom action class)"
                riskLevel="high"
                current={classBucket(cfg, name)}
                custom
              />
            ))}
          </tbody>
        </table>

        <details style={{ marginTop: 10 }}>
          <summary className="muted small" style={{ cursor: "pointer" }}>
            Add a custom action class
          </summary>
          <div className="row" style={{ gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              name="customActionClass"
              placeholder="e.g. dispatch_slurm_job"
              style={{ minWidth: 220, fontSize: 13 }}
            />
            <select name="customBucket" defaultValue="ask" style={{ fontSize: 13 }}>
              <option value="ask">Ask</option>
              <option value="propose">Propose</option>
              <option value="auto">Auto</option>
            </select>
            <span className="muted small">
              Will be added on Save.
            </span>
          </div>
        </details>

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div className="muted small" style={{ marginBottom: 6 }}>
            <strong>Cadence</strong> · how often the autonomous loops fire for
            this project. Defaults are conservative — most cycles emit nothing
            (the brain&apos;s voice contract is &quot;default silent&quot;).
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <label className="field" style={{ minWidth: 220 }}>
              <span className="muted small">Brain heartbeat</span>
              <select
                name="brainIntervalSec"
                defaultValue={brainSelectValue}
                style={{ fontSize: 13 }}
              >
                {BRAIN_CADENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ minWidth: 220 }}>
              <span className="muted small">Workhorse tick</span>
              <select
                name="workhorseIntervalSec"
                defaultValue={workhorseSelectValue}
                style={{ fontSize: 13 }}
              >
                {WORKHORSE_CADENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Defaults: brain {Math.round(DEFAULT_BRAIN_INTERVAL_SEC / 3600)}h ·
            workhorse {Math.round(DEFAULT_WORKHORSE_INTERVAL_SEC / 3600)}h.
            &quot;Paused&quot; means the worker tick skips this project entirely
            even if the autonomy bucket would otherwise fire.
          </div>
        </div>

        <div className="row" style={{ gap: 14, marginTop: 14, flexWrap: "wrap" }}>
          <label className="field" style={{ minWidth: 200 }}>
            <span className="muted small">spendCapGpuH (per project)</span>
            <input
              type="number"
              name="spendCapGpuH"
              defaultValue={cfg.spendCapGpuH ?? DEFAULT_AUTONOMY.spendCapGpuH}
              step={1}
              min={0}
              style={{ fontSize: 13 }}
            />
          </label>
          <label className="field" style={{ minWidth: 200 }}>
            <span className="muted small">spendCapTokensUsd (per day)</span>
            <input
              type="number"
              name="spendCapTokensUsd"
              defaultValue={cfg.spendCapTokensUsd ?? DEFAULT_AUTONOMY.spendCapTokensUsd}
              step={0.5}
              min={0}
              style={{ fontSize: 13 }}
            />
          </label>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button type="submit" className="button">
            Save autonomy
          </button>
        </div>
      </form>
    </div>
  );
}

function ActionRow({
  name,
  description,
  riskLevel,
  current,
  custom = false,
}: {
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  current: "auto" | "propose" | "ask";
  custom?: boolean;
}) {
  return (
    <tr>
      <td style={{ padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <code style={{ fontSize: 12 }}>{name}</code>
          <span
            className="pill"
            style={{
              background: RISK_COLORS[riskLevel],
              color: "#fff",
              fontSize: 10,
              padding: "1px 6px",
            }}
            title={`${riskLevel} risk`}
          >
            {riskLevel}
          </span>
          {custom ? <span className="pill pillMuted" style={{ fontSize: 10 }}>custom</span> : null}
        </div>
        <div className="muted small" style={{ marginTop: 2 }}>{description}</div>
      </td>
      {(["ask", "propose", "auto"] as const).map((bucket) => (
        <td
          key={bucket}
          style={{
            textAlign: "center",
            padding: "6px 4px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <input
            type="radio"
            name={`bucket__${name}`}
            value={bucket}
            defaultChecked={current === bucket}
          />
        </td>
      ))}
    </tr>
  );
}
