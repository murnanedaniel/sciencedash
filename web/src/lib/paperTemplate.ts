import type { PaperSectionKind } from "@/generated/prisma/client";

export type SectionSeed = {
  kind: PaperSectionKind;
  title: string;
  contentMd: string;
};

/**
 * §10.2 skeleton-first. The skeleton carries the narrative spine:
 * headings, a short intro stub, a short conclusion stub. Body sections
 * stay empty until the AI pass / human edit in M3.
 */
export const DEFAULT_SECTION_SEEDS: SectionSeed[] = [
  {
    kind: "intro",
    title: "Introduction",
    contentMd:
      "Context. Motivation. Claim in one sentence. What this paper contributes.",
  },
  {
    kind: "related",
    title: "Related work",
    contentMd: "",
  },
  {
    kind: "method",
    title: "Method",
    contentMd: "",
  },
  {
    kind: "experiments",
    title: "Experiments",
    contentMd: "Dataset. Training regime. Evaluation protocol.",
  },
  {
    kind: "results",
    title: "Results",
    contentMd: "",
  },
  {
    kind: "conclusion",
    title: "Conclusion",
    contentMd: "Restate the claim. Name the limit. Point at the next question.",
  },
  {
    kind: "figure_list",
    title: "Figures",
    contentMd: "",
  },
];
