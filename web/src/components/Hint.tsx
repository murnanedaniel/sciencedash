import type { ReactNode } from "react";

/**
 * Inline label with a hover/focus tooltip. Pure-CSS, no JS — uses
 * `:hover` + `:focus-within` so keyboard users get it too. The trigger
 * text gets a dotted underline as a discoverability hint.
 *
 * Usage:
 *   <Hint text="A stateless supervisor cycle…"><strong>Brain heartbeat</strong></Hint>
 *
 * For longer prose tooltips, pass `wide` to widen the tooltip body.
 */
export function Hint({
  text,
  children,
  wide = false,
}: {
  text: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <span className="hint" tabIndex={0} aria-label={text}>
      <span className="hintLabel">{children}</span>
      <span
        className={"hintBody" + (wide ? " hintBodyWide" : "")}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
