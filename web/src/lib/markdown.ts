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

import { Marked, marked } from "marked";

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

/* ------------------------- untrusted content ------------------------- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SAFE_HREF = /^(https?:|mailto:)/i;

/**
 * A separate marked instance for text the user did NOT write — forum
 * participants' turns, which can echo whatever a web page contained. Kept
 * apart from `renderMarkdown` so trusted pages keep inline HTML.
 *
 *  - Raw HTML is escaped, so `<script>` / `onerror=` render as text.
 *  - Links survive only for http(s)/mailto; anything else (`javascript:`)
 *    keeps its text and loses the link. Links open in a new tab.
 *  - Images become plain links: an inline image would make the viewer's
 *    browser fetch an arbitrary URL just by opening the forum.
 */
const untrusted = new Marked({
  gfm: true,
  async: false,
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    },
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      if (!SAFE_HREF.test(token.href)) return inner;
      return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
    image(token) {
      const label = escapeHtml(token.text || token.href);
      if (!SAFE_HREF.test(token.href)) return label;
      return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  },
});

export function renderUntrustedMarkdown(source: string): string {
  if (!source) return "";
  return untrusted.parse(source) as string;
}
