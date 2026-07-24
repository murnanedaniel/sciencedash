"use client";

import dynamic from "next/dynamic";

/**
 * Client boundary that loads the xterm.js terminal with SSR disabled.
 *
 * xterm's browser bundle touches `self` at module load, which throws during
 * server rendering (`ReferenceError: self is not defined`). `ssr: false` is
 * only allowed from a Client Component in Next 16, so this thin wrapper is
 * where the dynamic import lives; the server page renders <TerminalPane />.
 */
const TerminalClient = dynamic(
  () => import("./TerminalClient").then((m) => m.TerminalClient),
  {
    ssr: false,
    loading: () => <p className="muted small">Loading terminal…</p>,
  },
);

export function TerminalPane() {
  return <TerminalClient />;
}
