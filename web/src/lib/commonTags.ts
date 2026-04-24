// Clickable common-tag chips for new-project / edit-project forms.
// Kept as a flat list grouped by purpose, so the UI can render them as
// sections if it wants to. Everything is user-editable as a regular tag —
// these are just a convenience set of one-click additions.

export const COMMON_TAGS: Array<{ group: string; tags: string[] }> = [
  {
    group: "kind",
    tags: ["exploit", "explore", "system"],
  },
  {
    group: "program",
    tags: ["tracking", "calorimetry", "reconstruction", "foundation-model"],
  },
  {
    group: "ingredient",
    tags: [
      "ingredient",
      "sparsity",
      "multiscale",
      "multitask",
      "tokenization",
      "curriculum",
      "attention",
      "pretraining",
      "finetuning",
    ],
  },
  {
    group: "scope",
    tags: ["hl-lhc", "colliderml", "robustness", "short-paper"],
  },
];

/** Flat list (deduped, order preserved). */
export const COMMON_TAG_LIST: string[] = Array.from(
  new Set(COMMON_TAGS.flatMap((g) => g.tags)),
);
