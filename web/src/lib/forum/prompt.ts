/**
 * System-prompt assembly for forum participants.
 *
 * Every participant gets the same four blocks in the same order:
 *   1. The forum contract — what this surface is, who else is here, how to
 *      address them, and the length discipline that keeps a multi-party
 *      conversation readable.
 *   2. The topic the forum was convened around.
 *   3. This participant's persona (free text, set at creation).
 *   4. The linked project's brief, when the forum is attached to one.
 *
 * Crucially this is NOT where other participants' messages go. Those are
 * relayed as ordinary input turns (see relay.ts) — a participant sees the
 * conversation the way a person joining a call does, not as a static dump.
 */

import { prisma } from "@/lib/prisma";

type PromptInput = {
  selfHandle: string;
  otherHandles: string[];
  topic: string;
  persona: string;
  projectId: string | null;
  workdir: string | null;
  attachmentsDir: string;
};

function contract(
  self: string,
  others: string[],
  workdir: string | null,
  attachmentsDir: string,
): string {
  const roster = others.length
    ? others.map((h) => `\`@${h}\``).join(", ")
    : "_(no other AI participants yet)_";

  // Participants run in an empty scratch dir (see forumCwd in sessions.ts), so
  // anything they should look at has to be named by absolute path.
  const repo = workdir
    ? `The linked project's repository is at \`${workdir}\`. It is NOT your
working directory; your working directory is an empty scratch directory. Pass
the repository path explicitly whenever you search it: use it as the path
argument to Grep or Glob, or run \`rg … ${workdir}\` / \`ls ${workdir}\` in a
shell.

`
    : "";
  const locations = `## Locations

${repo}Files the human attaches are saved under \`${attachmentsDir}\` and
announced in the conversation with their full path. Read them from there. PDFs
can be read directly.`;

  return `# ScienceDash Forum

You are **@${self}**, one participant in a multi-party research conversation.

## Who is here

- **@${self}** — you.
- ${roster} — other AI participants. They are peers, not tools. They have their
  own reasoning and their own tool access, and they can be wrong.
- **@human** — the researcher who convened this forum. They are watching live
  and can interject at any time. When they do, their message takes priority
  over whatever was being discussed.

## How this works

- Other participants' turns arrive as input prefixed with their handle, like
  \`@codex: …\`. That is them speaking, not the human quoting them.
- Address someone with \`@handle\` to hand them the next turn. Address
  \`@human\` when you need a decision only they can make — that parks the
  forum until they reply.
- You are talking to the room. Do not open with "Certainly" or restate the
  question; continue the conversation.

## Length discipline

This is a conversation, not a report. Two or three short paragraphs is the
norm; a long structured answer is the exception and needs a reason. Nobody can
follow a forum where every turn is an essay.

## Disagreement

You are here because independent views are worth more than consensus. If
another participant is wrong, say which part and why, concretely. If they have
changed your mind, say so plainly and move on. Do not manufacture disagreement
to seem rigorous, and do not converge just to be agreeable.

## Tools

You have a read-and-research surface: read files at explicit paths, search
explicit directories, search the web, and query the ScienceDash store. You
cannot write files, edit code, or run shell commands that mutate anything —
this forum is for working out what should happen, not for doing it. If the
conclusion is that something should be built, say so and let @human take it
from there.

${locations}`;
}

/** Compact brief for the linked project, if any. */
async function projectBrief(projectId: string | null): Promise<string> {
  if (!projectId) return "";
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      status: true,
      description: true,
      hypothesis: true,
      figuresOfMerit: true,
      nextSteps: true,
      blockers: true,
    },
  });
  if (!p) return "";

  const lines = [
    "# Linked project",
    "",
    `**${p.title}** (\`${p.id}\`) · ${p.status}`,
  ];
  if (p.description) lines.push("", `${p.description}`);
  if (p.hypothesis) lines.push("", `**Hypothesis:** ${p.hypothesis}`);
  if (p.figuresOfMerit) {
    lines.push("", `**Figures of merit:** ${p.figuresOfMerit}`);
  }
  if (p.nextSteps) lines.push("", `**Next steps:** ${p.nextSteps}`);
  if (p.blockers) lines.push("", `**Blocked on:** ${p.blockers}`);
  lines.push(
    "",
    "Use `get_entity` / `query_entity` for anything about this project not shown here.",
  );
  return lines.join("\n");
}

export async function buildForumSystemPrompt(
  input: PromptInput,
): Promise<string> {
  const brief = await projectBrief(input.projectId);
  const blocks = [
    contract(
      input.selfHandle,
      input.otherHandles,
      input.workdir,
      input.attachmentsDir,
    ),
  ];

  if (input.topic.trim()) {
    blocks.push(`# Topic\n\n${input.topic.trim()}`);
  }
  if (input.persona.trim()) {
    blocks.push(`# Your brief\n\n${input.persona.trim()}`);
  }
  if (brief) blocks.push(brief);

  return blocks.join("\n\n---\n\n");
}
