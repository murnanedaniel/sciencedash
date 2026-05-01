"use client";

import { useState } from "react";

/**
 * Tiny "copy to clipboard" button. The label flips to "copied ✓" for
 * 1.5s on success. Used wherever we surface a recurring shell-command
 * pattern (git clone, scp + setup.sh, ssh -R tunnel, tmux attach …).
 *
 * Pass `value` for a static command, or `valueFn` for one computed at
 * click time (e.g. when it depends on dynamic state).
 */
export function CopyButton({
  value,
  valueFn,
  label = "Copy",
  copiedLabel = "copied ✓",
  title,
  size = "small",
  variant = "secondary",
}: {
  value?: string;
  valueFn?: () => string;
  label?: string;
  copiedLabel?: string;
  title?: string;
  size?: "small" | "regular";
  variant?: "primary" | "secondary";
}) {
  const [done, setDone] = useState(false);

  async function copy() {
    const v = valueFn ? valueFn() : (value ?? "");
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // Clipboard blocked (e.g. non-https or no user gesture).
      // Fallback: write to a hidden textarea + execCommand("copy").
      try {
        const ta = document.createElement("textarea");
        ta.value = v;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      } catch {
        // give up silently
      }
    }
  }

  const className =
    "button " +
    (variant === "primary" ? "" : "buttonSecondary ") +
    (size === "small" ? "small" : "");
  return (
    <button
      type="button"
      className={className.trim()}
      onClick={copy}
      title={title ?? `Copy: ${value ?? ""}`}
      style={size === "small" ? { padding: "2px 8px", fontSize: 11 } : undefined}
    >
      {done ? copiedLabel : label}
    </button>
  );
}
