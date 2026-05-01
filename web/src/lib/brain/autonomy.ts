/**
 * Autonomy spectrum — gates dispatch tool calls per project, per action
 * class. Conservative-by-default: anything not explicitly listed in
 * `auto` or `propose` is treated as `ask`.
 */

import { prisma } from "@/lib/prisma";

export type AutonomyDecision = "auto" | "propose" | "ask";

/**
 * Action classes the brain may try to dispatch. The list is
 * authoritative for the autonomy editor UI; new dispatch tools should
 * add their action class here with a description and risk tier so the
 * editor can render them with the right defaults and warnings.
 */
export const KNOWN_ACTION_CLASSES: Array<{
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
}> = [
  {
    name: "revive_session",
    description: "Restart a workhorse's tmux Claude session when the host's reaper has killed it.",
    riskLevel: "low",
  },
  {
    name: "restart_run",
    description: "Re-launch a failed/OOMed W&B run with the same or adjusted config.",
    riskLevel: "low",
  },
  {
    name: "launch_sweep",
    description: "Kick off a small W&B sweep on a workhorse (a handful of configurations).",
    riskLevel: "medium",
  },
  {
    name: "escalate_budget",
    description: "Bump a hypothesis's compute budget when the run trajectory justifies more GPU-hours.",
    riskLevel: "high",
  },
  {
    name: "narrow_scope",
    description: "Mutate a hypothesis or project's scope (description, figuresOfMerit) when it's drifting.",
    riskLevel: "high",
  },
  {
    name: "promote_to_paper",
    description: "Promote a hypothesis to a paper (creates Paper rows and changes narrativeReadiness).",
    riskLevel: "high",
  },
  {
    name: "park_hypothesis",
    description: "Mark a hypothesis as paused/abandoned (records a Decision row).",
    riskLevel: "high",
  },
];

export type AutonomyConfig = {
  auto: string[];
  propose: string[];
  ask: string[];
  /** Hard ceiling on GPU-hours dispatch tools may collectively fire on this project. */
  spendCapGpuH?: number;
  /** Hard ceiling on per-day Anthropic token cost in USD. */
  spendCapTokensUsd?: number;
};

export const DEFAULT_AUTONOMY: AutonomyConfig = {
  auto: [],
  propose: [],
  ask: [],
  spendCapGpuH: 50,
  spendCapTokensUsd: 5.0,
};

export async function getAutonomyConfig(projectId: string): Promise<AutonomyConfig> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { autonomyJson: true },
  });
  if (!p?.autonomyJson) return DEFAULT_AUTONOMY;
  try {
    const parsed = JSON.parse(p.autonomyJson) as Partial<AutonomyConfig>;
    return {
      auto: Array.isArray(parsed.auto) ? parsed.auto : [],
      propose: Array.isArray(parsed.propose) ? parsed.propose : [],
      ask: Array.isArray(parsed.ask) ? parsed.ask : [],
      spendCapGpuH:
        typeof parsed.spendCapGpuH === "number" ? parsed.spendCapGpuH : DEFAULT_AUTONOMY.spendCapGpuH,
      spendCapTokensUsd:
        typeof parsed.spendCapTokensUsd === "number"
          ? parsed.spendCapTokensUsd
          : DEFAULT_AUTONOMY.spendCapTokensUsd,
    };
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

/**
 * Decide what to do with a proposed dispatch action.
 *
 * - If `actionClass` is in `auto`: fire immediately.
 * - If in `propose`: fire AND post a "doing X, cancel within 60s" feed
 *   message (caller is responsible for the cancel-grace UX).
 * - Otherwise (default): post an "should I do X?" message and DON'T
 *   fire.
 */
export async function decideAutonomy(
  projectId: string,
  actionClass: string,
): Promise<AutonomyDecision> {
  const cfg = await getAutonomyConfig(projectId);
  if (cfg.auto.includes(actionClass)) return "auto";
  if (cfg.propose.includes(actionClass)) return "propose";
  return "ask";
}

export async function setAutonomyConfig(
  projectId: string,
  config: AutonomyConfig,
): Promise<void> {
  await prisma.project.update({
    where: { id: projectId },
    data: { autonomyJson: JSON.stringify(config) },
  });
}
