import { prisma } from "@/lib/prisma";
import type { DecisionKind } from "@/generated/prisma/client";

export async function recordDecision(opts: {
  kind: DecisionKind;
  subjectType: string;
  subjectId: string;
  projectId?: string | null;
  rationale?: string | null;
}) {
  return prisma.decision.create({
    data: {
      kind: opts.kind,
      subjectType: opts.subjectType,
      subjectId: opts.subjectId,
      projectId: opts.projectId ?? null,
      rationale: opts.rationale ?? null,
    },
  });
}
