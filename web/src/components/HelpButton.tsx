"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Topbar "?" link. Navigates to /docs (the comprehensive tutorial) and
 * supports a `?` keyboard shortcut from anywhere outside an input.
 */
export function HelpButton() {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === "?" &&
        !(e.target instanceof HTMLElement &&
          (e.target.tagName === "INPUT" ||
            e.target.tagName === "TEXTAREA" ||
            e.target.isContentEditable))
      ) {
        e.preventDefault();
        router.push("/docs");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <Link
      href="/docs"
      className="helpButton"
      aria-label="How does this work?"
      title="How does this work? (?)"
    >
      ?
    </Link>
  );
}
