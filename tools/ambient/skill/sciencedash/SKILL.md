---
name: sciencedash
description: >-
  Search the user's ScienceDash conversation history and project context, and
  log decisions. Use this whenever the user asks to FIND or RECALL past
  conversations / what was discussed or decided about a topic ("where did I talk
  about X", "find my conversations about Y", "what did we decide on Z"), wants
  context on one of their research projects, or asks to record a decision. Works
  from any machine — it queries the central ScienceDash store over its API.
---

# ScienceDash — ambient research context

ScienceDash ingests every Claude Code session transcript (from every machine)
into one searchable store, and holds the user's research projects (hypotheses,
runs, decisions, papers). This skill reaches that store from any session via a
small CLI; no MCP wiring needed.

Run the CLI with `python3 ~/.claude/skills/sciencedash/sd.py <command>`. It
auto-discovers the dashboard URL and bearer token (`~/.sciencedash/`), so you
normally don't need to configure anything.

## When to use

- **"Find / where did I discuss / what did we decide about <topic>"** →
  `sd.py search "<topic>"`. Returns ranked past conversations across all
  machines, with snippets and an `open:` URL for the full thread. Summarize the
  hits and surface the most relevant; offer to open or dig into one.
- **"What's the state of project <X>" / before starting work on a project** →
  `sd.py projects` to list them, then `sd.py context <projectId>` for that
  project's brief (status, hypothesis, figure of merit, next steps, metrics).
- **"Record / log this decision"** →
  `sd.py log-decision <projectId> "<one-line rationale>"`.

## Commands

```bash
python3 ~/.claude/skills/sciencedash/sd.py search "perlmutter sync resilience"
python3 ~/.claude/skills/sciencedash/sd.py projects
python3 ~/.claude/skills/sciencedash/sd.py context <projectId>
python3 ~/.claude/skills/sciencedash/sd.py log-decision <projectId> "chose FTS5 over LIKE for transcript search"
```

## Notes

- Search is full-text (FTS5) over the user's own conversation transcripts —
  prefer it over guessing when the user references something from "a while ago".
- Transcripts are redacted of secrets on ingest, so results never contain live
  keys/tokens.
- If a command prints an `error: HTTP 401`, the dashboard token isn't set on
  this machine — tell the user to run the ScienceDash ambient installer here.
