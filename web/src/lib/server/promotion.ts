import type { Project, Hypothesis, ProjectMetricDefinition } from "@/generated/prisma/client";

export type PromotionCheck = {
  ok: boolean;
  missing: string[];
};

/**
 * §16.1 — a project promoted from `idea` to `active` must have:
 *   hypothesis text, figures of merit, timeline, next steps,
 *   at least one Hypothesis row, and at least one primary ProjectMetricDefinition.
 */
export function checkPromotion(
  project: Pick<Project, "hypothesis" | "figuresOfMerit" | "timeline" | "nextSteps">,
  hypotheses: Pick<Hypothesis, "id">[],
  metricDefs: Pick<ProjectMetricDefinition, "id" | "isPrimary">[],
): PromotionCheck {
  const missing: string[] = [];
  if (!project.hypothesis?.trim()) missing.push("hypothesis");
  if (!project.figuresOfMerit?.trim()) missing.push("figures of merit");
  if (!project.timeline?.trim()) missing.push("timeline");
  if (!project.nextSteps?.trim()) missing.push("next steps");
  if (!hypotheses.length) missing.push("at least one hypothesis row");
  if (!metricDefs.some((m) => m.isPrimary)) missing.push("a primary metric");
  return { ok: missing.length === 0, missing };
}
