import { prisma } from "@/lib/prisma";

/**
 * Pull recent runs for every project with a configured W&B entity/project, and
 * upsert metric values on Run rows that already exist (matched by wandbRunId).
 * We don't create runs the user hasn't logged — this keeps the data model
 * honest and lets the user declare which runs are part of which hypothesis.
 */
export async function pullWandb(): Promise<{
  updated: number;
  scanned: number;
}> {
  const apiKey = process.env.WANDB_API_KEY;
  if (!apiKey) throw new Error("WANDB_API_KEY not set");

  const projects = await prisma.project.findMany({
    where: {
      NOT: [
        { wandbEntity: null },
        { wandbProject: null },
      ],
    },
    include: {
      metricDefinitions: true,
      hypotheses: { include: { runs: true } },
    },
  });

  let updated = 0;
  let scanned = 0;

  for (const p of projects) {
    if (!p.wandbEntity || !p.wandbProject) continue;
    const wandbIds = p.hypotheses
      .flatMap((h) => h.runs)
      .map((r) => r.wandbRunId)
      .filter((x): x is string => !!x);
    if (wandbIds.length === 0) continue;

    for (const runId of wandbIds) {
      scanned++;
      const data = await fetchRunSummary(apiKey, p.wandbEntity, p.wandbProject, runId).catch(() => null);
      if (!data) continue;

      const run = await prisma.run.findFirst({
        where: { wandbRunId: runId, hypothesis: { projectId: p.id } },
      });
      if (!run) continue;

      // Update run metadata
      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: data.state === "finished" ? "done" : data.state === "failed" ? "failed" : run.status,
          endedAt: data.endedAt ? new Date(data.endedAt) : run.endedAt,
          computeGpuHours: data.gpuHours ?? run.computeGpuHours,
        },
      });

      // Upsert metric values for any matching ProjectMetricDefinition
      for (const def of p.metricDefinitions) {
        const v = data.summary[def.name];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        await prisma.metric.upsert({
          where: { runId_definitionId: { runId: run.id, definitionId: def.id } },
          create: { runId: run.id, definitionId: def.id, value: v },
          update: { value: v },
        });
      }
      updated++;
    }
  }
  return { updated, scanned };
}

type WandbSummary = {
  state: string;
  endedAt: string | null;
  summary: Record<string, number>;
  gpuHours: number | null;
};

async function fetchRunSummary(
  apiKey: string,
  entity: string,
  project: string,
  runId: string,
): Promise<WandbSummary | null> {
  // W&B exposes a GraphQL endpoint at https://api.wandb.ai/graphql.
  const query = `query Run($entity:String!,$project:String!,$id:String!){
    project(name:$project, entityName:$entity){
      run(name:$id){
        state
        heartbeatAt
        summaryMetrics
        computeSeconds
      }
    }
  }`;
  const resp = await fetch("https://api.wandb.ai/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
    },
    body: JSON.stringify({
      query,
      variables: { entity, project, id: runId },
    }),
  });
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    data?: {
      project?: {
        run?: {
          state: string;
          heartbeatAt: string | null;
          summaryMetrics: string | null;
          computeSeconds: number | null;
        };
      };
    };
  };
  const run = json.data?.project?.run;
  if (!run) return null;
  let summary: Record<string, number> = {};
  if (run.summaryMetrics) {
    try {
      const parsed = JSON.parse(run.summaryMetrics) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number") summary[k] = v;
      }
    } catch {
      summary = {};
    }
  }
  return {
    state: run.state,
    endedAt: run.heartbeatAt,
    summary,
    gpuHours: run.computeSeconds != null ? run.computeSeconds / 3600 : null,
  };
}
