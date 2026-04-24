import { prisma } from "@/lib/prisma";

/**
 * Pull W&B summary metrics for every Run that has a wandbSourceId + wandbRunId
 * set. The source carries the entity/name pair. We only update existing Run
 * rows — runs the user hasn't logged stay absent, keeping the model honest.
 */
export async function pullWandb(): Promise<{
  updated: number;
  scanned: number;
}> {
  const apiKey = process.env.WANDB_API_KEY;
  if (!apiKey) throw new Error("WANDB_API_KEY not set");

  const runs = await prisma.run.findMany({
    where: {
      wandbRunId: { not: null },
      wandbSourceId: { not: null },
    },
    include: {
      wandbSource: true,
      hypothesis: {
        include: {
          project: {
            include: { metricDefinitions: true },
          },
        },
      },
    },
  });

  let updated = 0;
  let scanned = 0;

  for (const run of runs) {
    if (!run.wandbSource || !run.wandbRunId) continue;
    scanned++;
    const data = await fetchRunSummary(
      apiKey,
      run.wandbSource.entity,
      run.wandbSource.name,
      run.wandbRunId,
    ).catch(() => null);
    if (!data) continue;

    await prisma.run.update({
      where: { id: run.id },
      data: {
        status:
          data.state === "finished"
            ? "done"
            : data.state === "failed"
              ? "failed"
              : run.status,
        endedAt: data.endedAt ? new Date(data.endedAt) : run.endedAt,
        computeGpuHours: data.gpuHours ?? run.computeGpuHours,
      },
    });

    for (const def of run.hypothesis.project.metricDefinitions) {
      const v = data.summary[def.name];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      await prisma.metric.upsert({
        where: {
          runId_definitionId: { runId: run.id, definitionId: def.id },
        },
        create: { runId: run.id, definitionId: def.id, value: v },
        update: { value: v },
      });
    }
    updated++;
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
