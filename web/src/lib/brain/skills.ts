/**
 * Skill markdown shipped to the brain-chat workspace by the launcher.
 *
 * Each skill is a reusable recipe the chat brain can invoke when the user
 * asks for that kind of work — the brain calls ScienceDash tools (via the
 * `sciencedash` skill, `sd.py call <name> '<json>'`) in a known-good
 * sequence rather than rediscovering the shape every session.
 *
 * The launcher writes each skill to
 *   ~/.sciencedash/brain-chat/.claude/skills/<name>/SKILL.md
 * so Claude Code picks them up via its workspace skill discovery.
 *
 * Skill markdown format: YAML frontmatter (`name`, `description`) + a
 * markdown body with the recipe. `description` should make it clear when
 * to invoke; Claude routes user requests to the right skill from there.
 */

export type Skill = {
  name: string;
  filename: string; // SKILL.md (kept as a constant for clarity)
  body: string;
};

const WEEKLY_REVIEW = `---
name: weekly-review
description: Use when the user asks "what happened last week?", "give me a weekly digest", or invokes /weekly-review. Synthesises a digest of jobs run, agent messages surfaced, decisions made, and per-active-project state changes over the past 7 days.
---

# Weekly review

You are producing a tight, decision-shaped weekly digest of ScienceDash activity. Match the dashboard's terse tone — facts and changes, no padding.

## Steps

Tools are invoked through the \`sciencedash\` skill: \`sd.py call <name> '<json-args>'\`.

1. Compute "since" as the ISO-8601 timestamp from 7 days ago (e.g. with the user's clock).
2. Pull the inputs in parallel:
   - \`sd.py call query_entity '{"kind":"job","since":"<7d>"}'\` — every AI run (kind: project_brain, github_pull, ai_review, etc.). Note total cost (sum costUsd) and any failures.
   - \`sd.py call query_entity '{"kind":"message","since":"<7d>"}'\` — agent traffic across projects. Note severity=blocker / decision counts.
   - \`sd.py call query_entity '{"kind":"decision","since":"<7d>"}'\` — explicit decisions logged across projects (use a per-project pass if needed).
   - \`sd.py call query_entity '{"kind":"project","status":"active"}'\` — list of active projects to scope per-project sub-queries.
3. For each active project, briefly check: any new check-ins, runs, or significant state changes? Fetch via \`sd.py call query_entity '{"kind":"check_in","projectId":"...","since":"<7d>"}'\` (and \`kind="run"\`).
4. Synthesise a markdown digest with these sections:
   - **AI activity**: total jobs, total cost, # failures (link to /jobs if any).
   - **Cross-project signals**: any blocker-severity messages worth surfacing, decisions made.
   - **Per-project**: one short bullet per active project — what moved, what's pending.
   - **Heads-up for the week ahead** (if anything obvious): stale projects, blocker reasons that look stuck, repos not touched in 7+ days.

## Output

Show the digest to the user. Then ask whether to post it as a global agent message (no projectId) or pin it to a specific project. If they say yes, call \`sd.py call post_message '{"projectId":"...","body":"<digest>","kind":"digest","source":"brain-chat"}'\`.

Keep the whole digest under ~400 words. If something is too detailed for that, link to the relevant project page instead of inlining.
`;

const TRIAGE_FEED = `---
name: triage-feed
description: Use when the user asks to triage agent messages, "let's clear the feed", "what's unread?", or invokes /triage-feed. Walks through unread agent messages across projects, classifies them, and marks them read with rationale.
---

# Triage the agent feed

You are clearing the user's unread agent message backlog. Goal: every unread item is either acted on, has a clear next step, or is dismissed with a rationale — no item gets left "unread but actually you should look at this".

## Steps

Tools are invoked through the \`sciencedash\` skill: \`sd.py call <name> '<json-args>'\`.

1. Fetch unread messages (cross-project): \`sd.py call query_entity '{"kind":"message","unreadOnly":true,"limit":50}'\`.
2. Group them by project + severity. Show the user the count summary upfront ("12 unread: 1 blocker, 3 decision, 5 suggestion, 3 info").
3. Walk through them severity-first (blocker → decision → suggestion → info). For each:
   - Read the body. Decide: **act**, **defer**, or **dismiss**.
   - **Act**: take the action via the appropriate tool (e.g. \`set_project_blocker\`, \`update_entity\`, \`dispatch_workhorse\`, \`record_decision\`), then \`mark_message_read\`.
   - **Defer**: post a short check-in summarising what needs to happen and when (\`create_check_in\`), then mark read.
   - **Dismiss**: mark read with no follow-up. Reserve for items that are stale or already-addressed elsewhere.
4. Surface items that need a real human decision instead of triaging blindly. If unsure, ask the user — don't guess on blocker-severity items.

## Voice

Terse. One line per message in the walkthrough: \`<project> · <severity> · <one-line summary> → <act/defer/dismiss + reason>\`.

## End of session

Report: how many were acted on, deferred, dismissed; any items you escalated to the user; total time elapsed. Then submit_brain_chat as usual.
`;

const HEALTH_CHECK = `---
name: health-check
description: Use when the user asks "any issues?", "what's broken across my projects?", or invokes /health-check. Scans active projects for budget overruns, stale repos, idle workhorses, missing primary metrics, and other red-flag conditions.
---

# Project health check

You are scanning the active project portfolio for anything that needs attention. Output is a short list of red flags, each with a one-line "what to do about it".

Tools are invoked through the \`sciencedash\` skill: \`sd.py call <name> '<json-args>'\` — the \`name(args)\` notation below is shorthand for which tool + args.

## Checks

1. **Active projects**: \`query_entity(kind="project", status="active")\`. For each:
   - Fetch full state via \`get_entity(kind="project", id=...)\`. Note: missing primary metric, missing hypothesis, missing figuresOfMerit (these block §16.1 promotion / clean reporting).
   - Fetch hypotheses: \`query_entity(kind="hypothesis", projectId=...)\`. Flag any where \`computeUsedGpuHours > computeBudgetGpuHours\` (overspend without a budget_escalate decision).
   - Fetch repo links: \`query_entity(kind="repo_link", projectId=...)\`. Flag repos where \`cachedLastCommitAt\` is more than 7 days ago. Optionally call \`refresh_repo(projectId=...)\` first to make sure the cache is fresh.
   - Fetch workhorses: \`query_entity(kind="workhorse", projectId=...)\`. Flag any in state "dead" or "unreachable" — they should be restarted.

2. **Blocked projects**: \`query_entity(kind="project", status="blocked")\`. List each with its \`blockers\` text. If any blocker text looks like it might be resolved (e.g. dated language), surface it for the user to verify.

3. **Stalled active**: any active project with no run, decision, or check-in in the last 14 days. Use \`query_entity(kind="run" | "decision" | "check_in", projectId=..., since=<14d>)\` to confirm.

## Output

A markdown list of issues, severity-sorted (compute overrun > dead workhorse > stale repo > stalled project > missing metric). For each: project name + the issue + a recommended action (often a tool call you can run for them with confirmation).

If everything is healthy, say so plainly in one line. Don't pad.
`;

export const BRAIN_CHAT_SKILLS: ReadonlyArray<Skill> = [
  { name: "weekly-review", filename: "SKILL.md", body: WEEKLY_REVIEW },
  { name: "triage-feed", filename: "SKILL.md", body: TRIAGE_FEED },
  { name: "health-check", filename: "SKILL.md", body: HEALTH_CHECK },
];
