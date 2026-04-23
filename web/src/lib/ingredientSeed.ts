import { prisma } from "@/lib/prisma";
import type { IngredientCategory } from "@/generated/prisma/client";

type Seed = { category: IngredientCategory; name: string; description: string };

const SEEDS: Seed[] = [
  {
    category: "globalism",
    name: "full-event global attention",
    description: "Attention across the whole collision event, not local patches.",
  },
  {
    category: "sparsity",
    name: "block-sparse attention",
    description: "Sparse computation to escape quadratic attention scaling.",
  },
  {
    category: "multiscale",
    name: "hit/track/jet hierarchy",
    description: "Multiple representation levels trained jointly.",
  },
  {
    category: "multitask",
    name: "joint multitask training",
    description: "Train on multiple downstream tasks at once.",
  },
  {
    category: "tokenization",
    name: "per-hit tokenization",
    description: "How raw detector hits are turned into tokens.",
  },
  {
    category: "curriculum",
    name: "easy-to-hard curriculum",
    description: "Data schedule that ramps task difficulty.",
  },
  {
    category: "pretraining",
    name: "self-supervised pretraining",
    description: "Pretraining strategy (MLM, contrastive, reconstruction, etc.)",
  },
  {
    category: "finetuning",
    name: "linear-probe vs full-finetune",
    description: "Finetuning regime choice for downstream tasks.",
  },
  {
    category: "gen_vs_masked",
    name: "masked vs next-token",
    description: "Masked reconstruction vs autoregressive generation.",
  },
  {
    category: "fusion",
    name: "representation fusion",
    description: "Fusing features across levels / modalities.",
  },
  {
    category: "attention",
    name: "attention mechanism",
    description: "Dense / linear / mask-former / object-centric.",
  },
];

export async function ensureIngredientSeed(): Promise<void> {
  for (const s of SEEDS) {
    await prisma.ingredient.upsert({
      where: { category_name: { category: s.category, name: s.name } },
      create: s,
      update: {},
    });
  }
}
