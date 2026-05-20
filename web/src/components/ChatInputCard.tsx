"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Always-visible "what's on your mind?" textarea pinned to the top of
 * the homepage (/today). Submit redirects to /chat?q=<encoded>, where
 * the ChatClient fires the message as the first turn.
 *
 * Deliberately minimal — the actual chat lives at /chat. This is just
 * the entry point so the user never has to navigate first.
 */
export function ChatInputCard() {
  const router = useRouter();
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(`/chat?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div
      className="card"
      style={{
        padding: 14,
        marginBottom: 18,
        borderColor: "var(--accent, currentColor)",
      }}
    >
      <textarea
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="What's on your mind? (Cmd/Ctrl+Enter to send to chat)"
        style={{
          width: "100%",
          minHeight: 48,
          fontFamily: "inherit",
          fontSize: 15,
          border: "none",
          outline: "none",
          background: "transparent",
          resize: "vertical",
        }}
      />
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", marginTop: 4 }}
      >
        <span className="muted small">
          Chat fires MCP tools — projects, workhorses, posts, all in one place.
        </span>
        <button
          type="button"
          className="button"
          onClick={submit}
          disabled={!value.trim()}
          style={{ padding: "4px 14px", fontSize: 13 }}
        >
          Open chat →
        </button>
      </div>
    </div>
  );
}
