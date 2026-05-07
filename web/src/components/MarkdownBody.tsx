import { renderMarkdown } from "@/lib/markdown";
import { CollapsibleHtml } from "./CollapsibleHtml";

type Props = {
  source: string | null | undefined;
  /** Visual line cap when collapsed. Default 4. */
  maxLines?: number;
  /** Source-length cap (in chars) above which we collapse. Default 400. */
  maxChars?: number;
  /** Optional CSS class on the outer wrapper, in addition to `mdBody`. */
  className?: string;
};

/**
 * Render a markdown body inline with sensible inline typography (compact
 * paragraphs, tight lists, monospace for code). When the body is longer
 * than `maxChars` characters or `maxLines` newlines, it collapses to
 * the line cap with a "show more" toggle.
 *
 * Server component — markdown is parsed once on the server via the
 * `renderMarkdown` helper, then handed to a small client component for
 * the toggle. Marked stays out of the client bundle.
 *
 * Pass `null` / `undefined` source to render nothing.
 */
export function MarkdownBody({
  source,
  maxLines = 4,
  maxChars = 400,
  className,
}: Props) {
  if (!source) return null;
  const html = renderMarkdown(source);
  // Heuristic for "worth collapsing": either the source is meaningfully
  // longer than the inline cap, or it has more lines than will fit.
  // \r\n is normalised by counting \n only, which is fine for our content.
  const lineCount = (source.match(/\n/g)?.length ?? 0) + 1;
  const needsCollapse = source.length > maxChars || lineCount > maxLines;
  return (
    <CollapsibleHtml
      html={html}
      needsCollapse={needsCollapse}
      maxLines={maxLines}
      className={className}
    />
  );
}
