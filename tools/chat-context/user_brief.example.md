# User brief — the chat's persistent picture of who you are

Copy this file to `user_brief.md` and edit it. The dashboard's chat surface
(`/chat`) reads `user_brief.md` at request time and folds the content into the
system prompt, so changes show up on the next message — no restart required.
`user_brief.md` is gitignored so your personal context never gets committed.

## Who I am

- (Your role / field / what you work on.)
- (Any projects or affiliations the chat should know about.)
- (Where you compute day-to-day.)

## How I work

- (Tone + autonomy preferences — e.g. "be terse", "don't ask me to confirm
  spawning a workhorse, just fire it".)
- (Any standing instructions for how the chat should behave.)

## Hosts I have bootstrapped

(Edit this as your fleet grows. The chat references it when deciding where to
dispatch a workhorse.)

- **<host-name>** — (notes: is sync.py alive? where do project repos live? how
  are GPU jobs dispatched? any "don't spawn here" rules?)

## Current priorities

- (The chat leans on these when you ask "what should I work on?")
