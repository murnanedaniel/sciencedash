/**
 * Sample-data seed for ScienceDash.
 *
 *   npm run db:seed            # populate a fresh DB with demo content
 *   SCIENCEDASH_SEED_FORCE=1 npm run db:seed   # re-seed even if data exists
 *
 * Safe + idempotent: it upserts on fixed ids, and it refuses to run if the
 * database already has projects (unless SCIENCEDASH_SEED_FORCE is set), so it
 * never clobbers real research data. The content below is generic — it exists
 * only so a fresh clone opens to a populated dashboard instead of a blank one.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

// Fixed timestamps so re-running is deterministic.
const T = (iso: string) => new Date(iso);

async function main() {
  const existing = await prisma.project.count();
  if (existing > 0 && !process.env.SCIENCEDASH_SEED_FORCE) {
    console.log(
      `Database already has ${existing} project(s) — skipping seed. ` +
        `Set SCIENCEDASH_SEED_FORCE=1 to seed anyway.`,
    );
    return;
  }

  // --- Programme -----------------------------------------------------------
  const programme = await prisma.programme.upsert({
    where: { name: "Sample Research Programme" },
    update: {},
    create: {
      name: "Sample Research Programme",
      description:
        "A demo programme grouping a couple of related projects. Replace it " +
        "with your own — a programme is a cluster of projects sharing one " +
        "publication story.",
      targetVenues: "NeurIPS, JMLR",
      figuresOfMerit: "Accuracy at fixed compute; compression ratio.",
      status: "active",
      narrativeReadinessNote: "tracking 1 paper",
    },
  });

  // --- Tags ----------------------------------------------------------------
  const tagNames = ["explore", "exploit", "system"];
  for (const name of tagNames) {
    await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
  }
  const tagConnect = (names: string[]) => ({
    connect: names.map((name) => ({ name })),
  });

  // --- Projects ------------------------------------------------------------
  const p1 = await prisma.project.upsert({
    where: { id: "seed-project-classifier" },
    update: {},
    create: {
      id: "seed-project-classifier",
      title: "Faster Image Classifier",
      status: "active",
      description:
        "Can we match a ResNet baseline's accuracy with less compute by " +
        "tweaking the architecture? Demo project.",
      hypothesis: "Residual connections give the best accuracy-per-GPU-hour.",
      figuresOfMerit: "Top-1 accuracy at a fixed 5 GPU-h training budget.",
      timeline: "A few weeks of ablations, then write up.",
      nextSteps: "Sweep depth; try mixup; draft the paper.",
      narrativeReadiness: "figures_exist",
      programmeId: programme.id,
      tags: tagConnect(["explore", "system"]),
    },
  });

  const p2 = await prisma.project.upsert({
    where: { id: "seed-project-distillation" },
    update: {},
    create: {
      id: "seed-project-distillation",
      title: "Dataset Distillation Study",
      status: "active",
      description:
        "How small can the training set get before accuracy falls off? Demo " +
        "project.",
      hypothesis: "A distilled set hits 90% accuracy at 10x compression.",
      figuresOfMerit: "Compression ratio at >=90% of full-data accuracy.",
      timeline: "Exploratory.",
      nextSteps: "Tune the distillation objective.",
      narrativeReadiness: "draftable",
      programmeId: programme.id,
      tags: tagConnect(["explore"]),
    },
  });

  const p3 = await prisma.project.upsert({
    where: { id: "seed-project-baseline" },
    update: {},
    create: {
      id: "seed-project-baseline",
      title: "Legacy Baseline Sweep",
      status: "parked",
      description:
        "Old hyperparameter sweep, parked. Demo project showing a parked " +
        "state on the portfolio.",
      hypothesis: "Larger batch sizes train faster without hurting accuracy.",
      narrativeReadiness: "none",
      tags: tagConnect(["system"]),
    },
  });

  // --- Metric definitions --------------------------------------------------
  const accuracyDef = await prisma.projectMetricDefinition.upsert({
    where: { projectId_name: { projectId: p1.id, name: "accuracy" } },
    update: {},
    create: {
      projectId: p1.id,
      name: "accuracy",
      direction: "higher",
      isPrimary: true,
      threshold: 0.95,
    },
  });

  const compressionDef = await prisma.projectMetricDefinition.upsert({
    where: {
      projectId_name: { projectId: p2.id, name: "compression_ratio" },
    },
    update: {},
    create: {
      projectId: p2.id,
      name: "compression_ratio",
      unit: "x",
      direction: "higher",
      isPrimary: true,
      threshold: 10,
    },
  });

  // --- Hypotheses ----------------------------------------------------------
  const h1 = await prisma.hypothesis.upsert({
    where: { id: "seed-hyp-residual" },
    update: {},
    create: {
      id: "seed-hyp-residual",
      projectId: p1.id,
      title: "Residual connections beat a plain CNN at fixed compute",
      statement:
        "At a 5 GPU-h budget, a residual net reaches higher top-1 than a " +
        "plain CNN of the same depth.",
      status: "resolved",
      verdict: "supported",
      computeBudgetGpuHours: 10,
      resolvedAt: T("2026-05-18T12:00:00Z"),
    },
  });

  const h2 = await prisma.hypothesis.upsert({
    where: { id: "seed-hyp-mixup" },
    update: {},
    create: {
      id: "seed-hyp-mixup",
      projectId: p1.id,
      title: "Mixup augmentation improves generalization",
      statement: "Mixup raises validation accuracy without extra compute.",
      status: "active",
      verdict: "pending",
      computeBudgetGpuHours: 8,
    },
  });

  const h3 = await prisma.hypothesis.upsert({
    where: { id: "seed-hyp-distill" },
    update: {},
    create: {
      id: "seed-hyp-distill",
      projectId: p2.id,
      title: "Distilled set reaches 90% accuracy at 10x compression",
      status: "active",
      verdict: "pending",
      computeBudgetGpuHours: 12,
    },
  });

  // --- Runs + metrics ------------------------------------------------------
  const runSpec = [
    {
      id: "seed-run-baseline",
      hypothesisId: h1.id,
      name: "plain-cnn-baseline",
      computeGpuHours: 4,
      startedAt: T("2026-05-10T09:00:00Z"),
      endedAt: T("2026-05-10T13:00:00Z"),
      metric: { definitionId: accuracyDef.id, value: 0.91 },
    },
    {
      id: "seed-run-residual",
      hypothesisId: h1.id,
      name: "resnet-residual",
      computeGpuHours: 5,
      startedAt: T("2026-05-12T09:00:00Z"),
      endedAt: T("2026-05-12T14:00:00Z"),
      metric: { definitionId: accuracyDef.id, value: 0.94 },
    },
    {
      id: "seed-run-mixup",
      hypothesisId: h2.id,
      name: "resnet-mixup-a",
      computeGpuHours: 3,
      startedAt: T("2026-05-20T09:00:00Z"),
      endedAt: T("2026-05-20T12:00:00Z"),
      metric: { definitionId: accuracyDef.id, value: 0.93 },
    },
    {
      id: "seed-run-distill",
      hypothesisId: h3.id,
      name: "distill-v1",
      computeGpuHours: 6,
      startedAt: T("2026-05-22T09:00:00Z"),
      endedAt: T("2026-05-22T15:00:00Z"),
      metric: { definitionId: compressionDef.id, value: 8.5 },
    },
  ];

  for (const r of runSpec) {
    await prisma.run.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        hypothesisId: r.hypothesisId,
        name: r.name,
        status: "done",
        computeGpuHours: r.computeGpuHours,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      },
    });
    await prisma.metric.upsert({
      where: {
        runId_definitionId: { runId: r.id, definitionId: r.metric.definitionId },
      },
      update: { value: r.metric.value },
      create: {
        runId: r.id,
        definitionId: r.metric.definitionId,
        value: r.metric.value,
      },
    });
  }

  // --- Paper + sections ----------------------------------------------------
  const paper = await prisma.paper.upsert({
    where: { id: "seed-paper-residual" },
    update: {},
    create: {
      id: "seed-paper-residual",
      title: "Residual Connections for Compute-Efficient Image Classification",
      abstract:
        "We show that residual connections improve accuracy-per-GPU-hour " +
        "over a plain CNN baseline. (Demo paper skeleton.)",
      status: "skeleton",
      plannedVenue: "NeurIPS",
      primaryProjectId: p1.id,
    },
  });

  await prisma.hypothesisPaper.upsert({
    where: { hypothesisId_paperId: { hypothesisId: h1.id, paperId: paper.id } },
    update: {},
    create: { hypothesisId: h1.id, paperId: paper.id },
  });

  const sections: { kind: string; title: string; order: number }[] = [
    { kind: "intro", title: "Introduction", order: 0 },
    { kind: "related", title: "Related Work", order: 1 },
    { kind: "method", title: "Method", order: 2 },
    { kind: "experiments", title: "Experiments", order: 3 },
    { kind: "results", title: "Results", order: 4 },
    { kind: "conclusion", title: "Conclusion", order: 5 },
  ];
  for (const s of sections) {
    await prisma.paperSection.upsert({
      where: { id: `seed-section-${s.kind}` },
      update: {},
      create: {
        id: `seed-section-${s.kind}`,
        paperId: paper.id,
        kind: s.kind as never,
        title: s.title,
        contentMd: "",
        order: s.order,
      },
    });
  }

  // --- Decisions -----------------------------------------------------------
  await prisma.decision.upsert({
    where: { id: "seed-decision-resolve" },
    update: {},
    create: {
      id: "seed-decision-resolve",
      kind: "resolve",
      subjectType: "hypothesis",
      subjectId: h1.id,
      rationale: "Residual net beat the baseline by 3 points — supported.",
      projectId: p1.id,
      at: T("2026-05-18T12:05:00Z"),
    },
  });
  await prisma.decision.upsert({
    where: { id: "seed-decision-spawn" },
    update: {},
    create: {
      id: "seed-decision-spawn",
      kind: "spawn_paper",
      subjectType: "paper",
      subjectId: paper.id,
      rationale: "Supported hypothesis is narrative-ready — spawned a skeleton.",
      projectId: p1.id,
      at: T("2026-05-18T12:06:00Z"),
    },
  });

  // --- Reading notes -------------------------------------------------------
  const note = await prisma.note.upsert({
    where: { id: "seed-note-resnet" },
    update: {},
    create: {
      id: "seed-note-resnet",
      kind: "paper",
      title: "Deep Residual Learning for Image Recognition",
      authors: "He et al.",
      takeaway: "Residual connections let very deep nets train stably.",
    },
  });
  await prisma.noteProject.upsert({
    where: { noteId_projectId: { noteId: note.id, projectId: p1.id } },
    update: {},
    create: { noteId: note.id, projectId: p1.id },
  });

  console.log(
    `Seeded: 1 programme, 3 projects, 3 hypotheses, ${runSpec.length} runs, ` +
      `1 paper (6 sections), 2 decisions, 1 note.`,
  );
  void p3;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
