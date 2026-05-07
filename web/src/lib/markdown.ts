/**
 * Server-side markdown → HTML helper.
 *
 * Single render entry point used by `<MarkdownBody>` so we don't bundle
 * marked into the client bundle. Caches the parsed result by source
 * string within a request to avoid re-rendering when the same body is
 * shown twice on a page.
 *
 * GFM is on (tables, strikethrough, task lists). HTML inside markdown
 * is allowed — this is single-user content the user trusts. If we ever
 * surface untrusted markdown, run the output through DOMPurify here.
 */

import { marked } from "marked";

const cache = new Map<string, string>();
const CACHE_LIMIT = 200;

export function renderMarkdown(source: string | null | undefined): string {
  if (!source) return "";
  const hit = cache.get(source);
  if (hit !== undefined) return hit;
  // marked.parse can return a Promise when async extensions are
  // registered; force the sync path with the second arg.
  const html = marked.parse(source, { gfm: true, async: false }) as string;
  if (cache.size >= CACHE_LIMIT) {
    // Evict oldest. Map preserves insertion order so this is the LRU-ish.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(source, html);
  return html;
}
