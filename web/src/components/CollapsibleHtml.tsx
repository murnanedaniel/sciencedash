"use client";

import { useState } from "react";

type Props = {
  html: string;
  /** True when the body is long enough to bother collapsing. The server
   *  decides this based on source length / line count, so the client
   *  doesn't need to re-measure. */
  needsCollapse: boolean;
  /** Number of visual lines to show when collapsed. Default 4. */
  maxLines?: number;
  /** Optional CSS class on the outer wrapper, in addition to `mdBody`. */
  className?: string;
};

/**
 * Renders pre-parsed markdown HTML with an optional "show more / show
 * less" toggle. Always sets the `mdBody` class so global typography
 * styles apply. When `needsCollapse` is false, no toggle is shown and
 * content renders in full.
 *
 * Used via `<MarkdownBody>` (server component) which renders the
 * markdown server-side and decides whether collapse is warranted.
 */
export function CollapsibleHtml({
  html,
  needsCollapse,
  maxLines = 4,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!needsCollapse) {
    return (
      <div
        className={`mdBody ${className ?? ""}`.trim()}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div className={`mdBody ${className ?? ""}`.trim()}>
      <div
        className="mdBodyContent"
        style={
          !expanded
            ? {
                display: "-webkit-box",
                WebkitLineClamp: maxLines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : undefined
        }
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        type="button"
        className="mdToggleButton"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? "show less" : "show more"}
      </button>
    </div>
  );
}
