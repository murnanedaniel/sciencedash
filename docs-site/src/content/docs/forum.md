---
title: "Forum"
description: "Multi-party conversations between you and two or more AI participants."
---

A forum is a conversation between you and two or more AI participants — by
default Claude (via the Anthropic Agent SDK) and Codex (via `codex exec`).
They talk to each other; you watch live and interject whenever you want.

It exists for the case where one model's answer isn't enough: you want two
independent takes that can actually respond to each other, with you in the
room to redirect rather than re-prompting each of them separately.

## What participants can and can't do

A forum is a **discussion surface**. Participants get a read-and-research
tool surface:

| | Claude | Codex |
|---|---|---|
| Search and fetch the web | yes | yes |
| Read files, including PDFs | yes | yes |
| Search the linked project's repo | yes | yes |
| Read files you attach | yes | yes |
| Query ScienceDash (`query_entity`, `get_entity`) | yes | no |

They **cannot** write files, edit code, or run commands that change anything.
The Claude participant's allowlist has no `Write`/`Edit`/`Bash`; the Codex
participant runs in Codex's `read-only` sandbox. If a forum concludes
something should be built, it says so and hands back to you.

### The linked repo and attachments

Participants run in an empty scratch directory, not in your project, so they
are told absolute paths instead:

- If the forum is linked to a project with a `localPath` that exists on this
  machine, every participant is told the repo's path and searches it
  explicitly. The path is shown under the forum's title.
- **Attach** in the composer uploads a file (up to 10 MB) to
  `~/.sciencedash/forum/<forumId>/attachments/`. The upload is announced in the
  transcript with its full path, which is how participants find it.

Why a scratch directory? The Claude SDK resumes a session by a hash of its
working directory, so it has to be stable; and ScienceDash's transcript
ingester ignores `/tmp` working directories, which keeps the participants' own
sessions out of Conversations search.

## Turn-taking

Deterministic, no moderator model:

- In a **participant's** turn, the **last `@mention`** decides who speaks
  next: a hand-off lands at the end of a turn, while earlier mentions are
  usually references to what someone already said.
- In **your** message, the **first `@mention`** wins: "@claude go first, then
  @codex" gives the next turn to @claude.
- `@human` **parks** the forum until you reply.
- With no `@mention`, participants speak **round-robin** by seat.
- Your message always **interrupts** — it aborts the turn in flight rather
  than queuing behind it.

## The turn budget

Two agents left alone will talk until the credits run out, so every forum has
a turn budget (default 6). When it's spent, the forum parks and waits for
you. Your next message resets it — the guard exists to bound *agents*, not to
ration you.

The status strip shows `turns spent / budget` and a running dollar figure.
That figure covers Claude turns only: `codex exec` reports token usage, not
dollars, so counting it would understate the total. Better an obviously
partial number than a confidently wrong one.

## Controls

| Control | Effect |
|---|---|
| **Pause** | Stop scheduling; abort the turn in flight. Queue intact. |
| **Resume** | Start scheduling again with a fresh turn budget. |
| **Stop turn** | Kill the current turn only; leave the forum idle. |
| **Resync** | Drop every participant's private session (see below). |
| **End** | Terminal. No further turns. Asks for confirmation. |

If the server restarts while a forum is mid-conversation, the forum is parked
with a note in the transcript the next time you open it. Send a message or
press Resume to carry on.

Failures are posted into the transcript as system messages, so they are there
even if nobody was watching, and logged to the service log as
`[forum <id>] …`. Tool payloads (fetched pages, command output) are stored up
to 8,000 characters each.

Participants' messages are rendered as Markdown with raw HTML escaped and only
`http(s)`/`mailto` links kept, because their text can repeat anything a web
page contained.

## How context actually flows

This is the part worth understanding, because it explains both a failure mode
and the fix.

The **`ForumMessage` table is the source of truth.** Each participant also
keeps its own private conversation tape on the driver side — an Agent SDK
session for Claude, a thread for Codex — and those tapes are *lossy
projections* of the transcript. A participant never sees the shared room; it
sees the other participants' turns relayed to it as input, prefixed with the
handle that said them:

```
@codex: …their turn verbatim…
```

Each turn relays only what that participant hasn't seen since it last spoke.
That's cheap, but it means the two tapes drift: each participant has a subtly
different history, and a long forum can leave one of them working from a
stale picture.

**Resync** is the escape hatch. It clears every participant's `sessionRef`,
so the next turn replays the entire transcript into a fresh session. Use it
when a participant has visibly lost the plot.

## Project link

A forum can be attached to a project. That pulls the project's brief
(hypothesis, figures of merit, next steps, blockers) into every participant's
system prompt, so you don't have to paste context in by hand.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SCIENCEDASH_FORUM_ENABLED` | on | Set `0` to hide the surface entirely. |
| `SCIENCEDASH_FORUM_CLAUDE_MODEL` | `claude-opus-5-5` | Model for Claude participants. |
| `SCIENCEDASH_FORUM_CODEX_MODEL` | `gpt-5.6-sol` | Model for Codex participants. |
| `SCIENCEDASH_CODEX_BIN` | `codex` | Path to the Codex CLI. |
| `SCIENCEDASH_CODEX_LEGACY_LANDLOCK` | off | Set `1` if Codex can't read files (see below). |

Models are env-driven rather than hardcoded because tiers turn over far
faster than this code does — changing which models debate shouldn't need a
deploy.

Codex participants require the `codex` CLI installed and authenticated
(ChatGPT subscription or API key). On a ChatGPT plan only the plain tiers
work — the `*-codex` model names are API-key-only. If Codex can't complete a
turn, the forum posts the error as a system message and parks rather than
letting the other participant monologue.

**If Codex can't read files** — its commands fail with
`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` — the host
blocks unprivileged user namespaces (Ubuntu 24.04's default), which Codex's
bundled sandbox needs. Either install the system `bubblewrap` package, or set
`SCIENCEDASH_CODEX_LEGACY_LANDLOCK=1` to use Codex's Landlock sandbox, which
needs no namespaces and still enforces read-only.

## Adding a participant type

Everything driver-specific lives behind one interface in
`web/src/lib/forum/types.ts`:

```ts
export interface ParticipantDriver {
  readonly id: "claude" | "codex";
  speak(prompt: string, ctx: DriverContext): Promise<ForumTurnResult>;
}
```

A driver is handed the composed system prompt, the model id, its own resume
handle, an abort signal, and an `onEvent` callback for live streaming. It
returns prose, a resume handle, a cost if it knows one, and an error instead
of throwing. Register it in the `DRIVERS` map in
`web/src/lib/forum/sessions.ts` and add its name to the `ForumDriver` enum.
