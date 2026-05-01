/**
 * Two-tier project-brain memory (Deep Researcher Agent pattern).
 *
 * Tier 1 — Project Brief (≤3K chars, frozen): auto-derived from the DB
 * each cycle (title, hypothesis, primary metric, tags, narrative state,
 * blockers). Cannot be modified by the brain.
 *
 * Tier 2 — Memory Log (≤2K chars, brain-maintained): rolling key results
 * (FIFO when over 1.2K) + 15-entry decision window. Compaction is lossy
 * by design — older routine entries fall off.
 *
 * Reference: arXiv 2604.05854 (Deep Researcher Agent), §3.
 */

import { prisma } from "@/lib/prisma";
import { promises as fs } from "node:fs";
import path from "node:path";

const TIER1_MAX = 3000;
const TIER2_MAX = 2000;
const KEY_RESULTS_MAX = 1200;
const RECENT_DECISIONS_MAX_ENTRIES = 15;

export type BrainMemory = {
  brief: string; // tier 1
  memoryLog: string; // tier 2 (key results + recent decisions)
  humanDirective: string | null; // optional pending nudge from the user
};

/**
 * Build the frozen tier-1 PROJECT_BRIEF from current DB state.
 */
export async function assembleBrief(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      tags: { select: { name: true } },
      metricDefinitions: { where: { isPrimary: true } },
      hypotheses: { select: { id: true, title: true, status: true } },
      _count: { select: { hypotheses: true, decisions: true, notes: true } },
    },
  });
  if (!project) throw new Error(`project not found: ${projectId}`);

  const primary = project.metricDefinitions[0];
  const lines: string[] = [];
  lines.push(`# Project Brief — ${project.title}`);
  lines.push("");
  lines.push(`status: ${project.status}`);
  lines.push(`narrativeReadiness: ${project.narrativeReadiness}`);
  if (project.tags.length) lines.push(`tags: ${project.tags.map((t) => t.name).join(", ")}`);
  lines.push("");
  if (project.hypothesis) {
    lines.push(`## Hypothesis`);
    lines.push(project.hypothesis);
    lines.push("");
  }
  if (project.description) {
    lines.push(`## Description`);
    lines.push(project.description);
    lines.push("");
  }
  if (primary) {
    lines.push(`## Primary metric`);
    lines.push(
      `${primary.name}${primary.unit ? ` (${primary.unit})` : ""} — direction: ${primary.direction}` +
        (primary.threshold != null ? ` — threshold: ${primary.threshold}` : ""),
    );
    lines.push("");
  }
  if (project.figuresOfMerit) {
    lines.push(`## Figures of merit`);
    lines.push(project.figuresOfMerit);
    lines.push("");
  }
  if (project.blockers) {
    lines.push(`## Blockers`);
    lines.push(project.blockers);
    lines.push("");
  }
  if (project.nextSteps) {
    lines.push(`## Next steps`);
    lines.push(project.nextSteps);
    lines.push("");
  }
  lines.push(`## Counts`);
  lines.push(
    `hypotheses=${project._count.hypotheses}, decisions=${project._count.decisions}, notes=${project._count.notes}`,
  );

  let out = lines.join("\n");
  if (out.length > TIER1_MAX) {
    out = out.slice(0, TIER1_MAX - 20) + "\n… [brief truncated]";
  }
  return out;
}

/**
 * Read the brain's tier-2 memory from the DB (canonical) and optionally
 * mirror to filesystem at <localPath>/.sciencedash/MEMORY_LOG.md.
 */
export async function loadMemoryLog(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { brainMemoryLog: true },
  });
  return project?.brainMemoryLog ?? "";
}

/**
 * Persist a new memory log. Compacts to tier-2 caps before storing.
 * Mirrors to <localPath>/.sciencedash/MEMORY_LOG.md if localPath is set.
 */
export async function saveMemoryLog(projectId: string, raw: string): Promise<string> {
  const compacted = compactMemoryLog(raw);
  await prisma.project.update({
    where: { id: projectId },
    data: { brainMemoryLog: compacted, brainLastHeartbeatAt: new Date() },
  });
  // Mirror best-effort.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { localPath: true },
  });
  if (project?.localPath) {
    const dir = path.join(project.localPath, ".sciencedash");
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "MEMORY_LOG.md"), compacted + "\n", "utf-8");
    } catch {
      // ignore — DB is canonical
    }
  }
  return compacted;
}

/**
 * Read the project's pending HUMAN_DIRECTIVE without consuming it.
 *
 * Used by the editor UI's initial-value resolution: prefer the
 * DB-canonical `Project.brainDirective`, fall back to the file mirror
 * at `<localPath>/.sciencedash/HUMAN_DIRECTIVE.md` so directives the
 * user wrote pre-UI (or via terminal) appear in the editor.
 *
 * Returns null when neither source has content.
 */
export async function readHumanDirective(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { localPath: true, brainDirective: true },
  });
  if (!project) return null;
  if (project.brainDirective && project.brainDirective.trim().length > 0) {
    return project.brainDirective;
  }
  if (project.localPath) {
    const file = path.join(project.localPath, ".sciencedash", "HUMAN_DIRECTIVE.md");
    try {
      const raw = await fs.readFile(file, "utf-8");
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Consume the project's pending HUMAN_DIRECTIVE.
 *
 * Source-of-truth is `Project.brainDirective` in the DB (set by the
 * dashboard's directive editor). For backward compatibility, also
 * checks <localPath>/.sciencedash/HUMAN_DIRECTIVE.md and uses that if
 * the DB is empty. On consumption: clears the DB field, sets
 * brainDirectiveConsumedAt, and archives the file mirror (if any) as
 * HUMAN_DIRECTIVE.<timestamp>.md so it's consumed exactly once.
 */
export async function consumeHumanDirective(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { localPath: true, brainDirective: true },
  });
  if (!project) return null;

  let content: string | null = null;

  // 1. Prefer the DB-stored directive (canonical).
  if (project.brainDirective && project.brainDirective.trim().length > 0) {
    content = project.brainDirective.trim();
  }

  // 2. Fallback: read the file mirror if the DB is empty.
  if (!content && project.localPath) {
    const file = path.join(project.localPath, ".sciencedash", "HUMAN_DIRECTIVE.md");
    try {
      const raw = await fs.readFile(file, "utf-8");
      content = raw.trim() || null;
    } catch {
      // no file — that's fine
    }
  }

  if (!content) return null;

  // 3. Mark consumed in DB.
  await prisma.project.update({
    where: { id: projectId },
    data: {
      brainDirective: null,
      brainDirectiveConsumedAt: new Date(),
    },
  });

  // 4. Archive the file mirror, if any (best-effort).
  if (project.localPath) {
    const dir = path.join(project.localPath, ".sciencedash");
    const file = path.join(dir, "HUMAN_DIRECTIVE.md");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archive = path.join(dir, `HUMAN_DIRECTIVE.${ts}.md`);
    try {
      await fs.rename(file, archive);
    } catch {
      // file might not exist; that's fine
    }
  }

  return content;
}

/**
 * Enforce tier-2 caps on the memory log:
 * - Total ≤ 2000 chars.
 * - "## Key Results" section: FIFO when its content exceeds 1200 chars.
 * - "## Recent Decisions" section: keep only the last 15 entries
 *   (an entry is a `- ...` bullet line, possibly with continuation lines).
 *
 * Lossy by design.
 */
export function compactMemoryLog(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const sections = splitSections(trimmed);
  const keyResults = sections["Key Results"] ?? "";
  const recentDecisions = sections["Recent Decisions"] ?? "";
  // Drop the implicit "_preamble" bucket and any other unnamed sections —
  // they're typically junk (e.g. trailing whitespace) when the brain
  // returns clean section headers.
  const other = Object.entries(sections)
    .filter(([k]) => k !== "Key Results" && k !== "Recent Decisions" && k !== "_preamble")
    .filter(([, v]) => v.trim().length > 0)
    .map(([k, v]) => `## ${k}\n${v.trim()}`)
    .join("\n\n");

  // Compact Key Results — FIFO oldest entries when over cap.
  const compactedKR = compactSectionByChars(keyResults, KEY_RESULTS_MAX);
  // Compact Recent Decisions — keep most recent N.
  const compactedRD = compactSectionByEntries(recentDecisions, RECENT_DECISIONS_MAX_ENTRIES);

  const parts: string[] = [];
  if (compactedKR.trim()) parts.push(`## Key Results\n${compactedKR.trim()}`);
  if (compactedRD.trim()) parts.push(`## Recent Decisions\n${compactedRD.trim()}`);
  if (other) parts.push(other);
  let out = parts.join("\n\n");
  if (out.length > TIER2_MAX) out = out.slice(0, TIER2_MAX - 20) + "\n… [memory truncated]";
  return out;
}

function splitSections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = md.split(/\r?\n/);
  let current = "_preamble";
  let buf: string[] = [];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      out[current] = buf.join("\n").trim();
      current = m[1].trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  out[current] = buf.join("\n").trim();
  return out;
}

function compactSectionByChars(section: string, cap: number): string {
  const lines = section.split(/\r?\n/);
  // Walk from oldest (top) and drop until we're within cap.
  let total = lines.join("\n").length;
  let i = 0;
  while (total > cap && i < lines.length) {
    total -= (lines[i]?.length ?? 0) + 1;
    i++;
  }
  return lines.slice(i).join("\n").trim();
}

function compactSectionByEntries(section: string, maxEntries: number): string {
  // Group by top-level `- ` bullets; keep the last N.
  const lines = section.split(/\r?\n/);
  const groups: string[][] = [];
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      groups.push([line]);
    } else if (groups.length > 0) {
      groups[groups.length - 1]!.push(line);
    } else if (line.trim()) {
      // orphan content before any bullet; treat as its own group
      groups.push([line]);
    }
  }
  const kept = groups.slice(-maxEntries);
  return kept.map((g) => g.join("\n")).join("\n");
}

/**
 * Convenience: build the full memory bundle to seed a heartbeat.
 */
export async function assembleMemory(projectId: string): Promise<BrainMemory> {
  const [brief, memoryLog, humanDirective] = await Promise.all([
    assembleBrief(projectId),
    loadMemoryLog(projectId),
    consumeHumanDirective(projectId),
  ]);
  return { brief, memoryLog, humanDirective };
}
