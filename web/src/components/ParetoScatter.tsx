"use client";

import { useMemo, useState } from "react";

type Point = {
  id: string;
  label: string;
  metrics: Record<string, number>;
};

type MetricDef = {
  name: string;
  direction: "higher" | "lower";
  unit?: string | null;
};

export function ParetoScatter({
  points,
  metrics,
}: {
  points: Point[];
  metrics: MetricDef[];
}) {
  const [xAxis, setXAxis] = useState(metrics[0]?.name ?? "");
  const [yAxis, setYAxis] = useState(metrics[1]?.name ?? metrics[0]?.name ?? "");

  const plotted = useMemo(
    () =>
      points.filter(
        (p) => xAxis in p.metrics && yAxis in p.metrics,
      ),
    [points, xAxis, yAxis],
  );

  const xs = plotted.map((p) => p.metrics[xAxis]!);
  const ys = plotted.map((p) => p.metrics[yAxis]!);
  const xmin = Math.min(...xs, 0);
  const xmax = Math.max(...xs, 1);
  const ymin = Math.min(...ys, 0);
  const ymax = Math.max(...ys, 1);

  const W = 520;
  const H = 360;
  const M = { l: 56, r: 18, t: 18, b: 44 };

  function sx(v: number) {
    const t = (v - xmin) / Math.max(1e-9, xmax - xmin);
    return M.l + t * (W - M.l - M.r);
  }
  function sy(v: number) {
    const t = (v - ymin) / Math.max(1e-9, ymax - ymin);
    return H - M.b - t * (H - M.t - M.b);
  }

  // Pareto frontier — depending on directions.
  const xDir = metrics.find((m) => m.name === xAxis)?.direction ?? "higher";
  const yDir = metrics.find((m) => m.name === yAxis)?.direction ?? "higher";
  function dominates(a: Point, b: Point): boolean {
    const ax = a.metrics[xAxis]!;
    const ay = a.metrics[yAxis]!;
    const bx = b.metrics[xAxis]!;
    const by = b.metrics[yAxis]!;
    const xBetter = xDir === "higher" ? ax > bx : ax < bx;
    const yBetter = yDir === "higher" ? ay > by : ay < by;
    const xEqual = ax === bx;
    const yEqual = ay === by;
    const notWorseX = xDir === "higher" ? ax >= bx : ax <= bx;
    const notWorseY = yDir === "higher" ? ay >= by : ay <= by;
    return notWorseX && notWorseY && (xBetter || yBetter) && !(xEqual && yEqual);
  }
  const frontier = new Set(
    plotted
      .filter((p) => !plotted.some((q) => q !== p && dominates(q, p)))
      .map((p) => p.id),
  );

  return (
    <div className="pareto">
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <div className="field">
          <label>X</label>
          <select value={xAxis} onChange={(e) => setXAxis(e.target.value)}>
            {metrics.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} {m.unit ? `(${m.unit})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Y</label>
          <select value={yAxis} onChange={(e) => setYAxis(e.target.value)}>
            {metrics.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} {m.unit ? `(${m.unit})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <svg width={W} height={H} style={{ maxWidth: "100%", height: "auto" }}>
        {/* Axes */}
        <line x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} stroke="currentColor" opacity={0.25} />
        <line x1={M.l} y1={M.t} x2={M.l} y2={H - M.b} stroke="currentColor" opacity={0.25} />

        {/* Points */}
        {plotted.map((p) => {
          const onFront = frontier.has(p.id);
          return (
            <g key={p.id}>
              <circle
                cx={sx(p.metrics[xAxis]!)}
                cy={sy(p.metrics[yAxis]!)}
                r={onFront ? 6 : 4}
                fill={onFront ? "var(--accent)" : "var(--muted)"}
                opacity={onFront ? 0.9 : 0.55}
              />
              <title>{`${p.label}\n${xAxis}=${p.metrics[xAxis]!}\n${yAxis}=${p.metrics[yAxis]!}`}</title>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={W / 2} y={H - 10} textAnchor="middle" className="axisLabel">
          {xAxis} ({xDir})
        </text>
        <text x={14} y={H / 2} textAnchor="middle" className="axisLabel" transform={`rotate(-90 14 ${H / 2})`}>
          {yAxis} ({yDir})
        </text>

        {/* Min / max ticks */}
        <text x={M.l} y={H - M.b + 14} textAnchor="middle" className="axisLabel">{xmin.toFixed(3)}</text>
        <text x={W - M.r} y={H - M.b + 14} textAnchor="middle" className="axisLabel">{xmax.toFixed(3)}</text>
        <text x={M.l - 6} y={H - M.b} textAnchor="end" className="axisLabel">{ymin.toFixed(3)}</text>
        <text x={M.l - 6} y={M.t + 6} textAnchor="end" className="axisLabel">{ymax.toFixed(3)}</text>
      </svg>
      <p className="muted small" style={{ marginTop: 8 }}>
        {plotted.length} run(s) plotted · {frontier.size} on the Pareto frontier.
      </p>
    </div>
  );
}
