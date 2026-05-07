"use client";

import { useEffect, useState, useCallback } from "react";

type CiStatus = "passed" | "pending" | "failed" | "no-runs" | "error";

type StatusResult = {
  currentSha: string | null;
  lastDeploy: { sha: string; at: string } | null;
  ciStatus: CiStatus;
  remoteSha: string | null;
  pending: boolean;
};

const CI_PILL_STYLE: Record<CiStatus, { bg: string; label: string }> = {
  passed: { bg: "var(--accent, #6a4cd6)", label: "CI passed" },
  pending: { bg: "var(--accent2, #b08a3a)", label: "CI pending" },
  failed: { bg: "var(--red, #c0322a)", label: "CI failed" },
  "no-runs": { bg: "var(--muted, #888)", label: "no CI" },
  error: { bg: "var(--muted, #888)", label: "CI status unknown" },
};

/**
 * Live status of the auto-deploy poller. Shows the SHA on disk, the SHA
 * at origin/main, the CI status of HEAD, and the last successful deploy.
 * The "Deploy now" button POSTs to /api/deploy/trigger to skip the
 * 90-second poll wait — the script still gates on CI either way.
 */
export function DeployStatusWidget() {
  const [data, setData] = useState<StatusResult | null>(null);
  const [busy, setBusy] = useState<"deploying" | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/deploy/status", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as StatusResult);
    } catch {
      // network error — leave previous data, will retry next tick
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function deployNow() {
    setBusy("deploying");
    setHint(null);
    try {
      const res = await fetch("/api/deploy/trigger", { method: "POST" });
      if (!res.ok) {
        setHint("trigger failed — check ~/.sciencedash/deploy.log");
      } else {
        setHint("deploy spawned — refreshing in a few seconds");
      }
    } catch {
      setHint("trigger failed — server unreachable?");
    }
    // Give deploy.sh a head start before we re-query status.
    setTimeout(() => {
      refresh();
      setBusy(null);
    }, 4000);
  }

  if (!data) {
    return (
      <div className="card">
        <h2 className="sectionTitle">Deploy</h2>
        <p className="muted small" style={{ margin: 0 }}>Loading…</p>
      </div>
    );
  }

  const ci = CI_PILL_STYLE[data.ciStatus];

  return (
    <div className="card">
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <h2 className="sectionTitle" style={{ marginBottom: 4 }}>
            Deploy
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Auto-pulls from <code>origin/main</code> every ~90s when CI passes.
            Logs:{" "}
            <code style={{ fontFamily: "var(--font-geist-mono)" }}>
              ~/.sciencedash/deploy.log
            </code>
          </p>
        </div>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span
            className="pill"
            style={{ background: ci.bg, color: "#fff" }}
            title={`CI status of ${shortSha(data.remoteSha)} (origin/main)`}
          >
            {ci.label}
          </span>
          <button
            type="button"
            className="button"
            onClick={deployNow}
            disabled={busy !== null || data.ciStatus === "failed"}
            title={
              data.ciStatus === "failed"
                ? "Refusing — CI failed for the current origin/main tip"
                : "Run deploy.sh now (still gated on CI)"
            }
          >
            {busy ? "…" : "Deploy now"}
          </button>
        </div>
      </div>

      <div
        className="stackTight"
        style={{ marginTop: 12, fontSize: 13 }}
      >
        <Row
          label="On disk"
          value={
            <code style={{ fontFamily: "var(--font-geist-mono)" }}>
              {shortSha(data.currentSha)}
            </code>
          }
        />
        <Row
          label="origin/main"
          value={
            <span>
              <code style={{ fontFamily: "var(--font-geist-mono)" }}>
                {shortSha(data.remoteSha)}
              </code>
              {data.pending ? (
                <span
                  className="pill"
                  style={{
                    background: "var(--accent2, #b08a3a)",
                    color: "#fff",
                    marginLeft: 8,
                  }}
                  title="A newer commit is on origin/main than is deployed. Will deploy next tick if CI is passed."
                >
                  pending
                </span>
              ) : null}
            </span>
          }
        />
        <Row
          label="Last deploy"
          value={
            data.lastDeploy ? (
              <span>
                <code style={{ fontFamily: "var(--font-geist-mono)" }}>
                  {shortSha(data.lastDeploy.sha)}
                </code>
                <span className="muted small" style={{ marginLeft: 8 }}>
                  {data.lastDeploy.at}
                </span>
              </span>
            ) : (
              <span className="muted small">never</span>
            )
          }
        />
      </div>

      {hint ? (
        <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <span
        className="muted small"
        style={{ minWidth: 90, letterSpacing: "0.04em" }}
      >
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

function shortSha(s: string | null): string {
  return s ? s.slice(0, 7) : "—";
}
