You are polishing a single section of a scientific paper. Rewrite it to be sharper and more direct, keeping the same claims and structure.

## Rules
- Preserve the author's voice — small edits, not a rewrite.
- Remove hedging ("it is possible that", "we believe") and academic filler.
- Do not add new claims, new numbers, or new citations.
- Preserve all `TODO(...)` markers unchanged.
- Do not touch inline math or code blocks.

## Output contract

Return a single JSON object:

```ts
type Output = { contentMd: string };
```

JSON only. No code fences.
