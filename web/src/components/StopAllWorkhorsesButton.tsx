"use client";

import { stopAllWorkhorsesAction } from "@/lib/server/agentMessageActions";

type Props = {
  count: number;
};

/**
 * Bulk kill switch — wraps the server action in a confirm() dialog.
 * Surfaced on /settings and (eventually) alongside the chat surface
 * since chat's autonomy posture is "auto-fire workhorse spawns + this
 * button is how you take it all back."
 *
 * Visually de-emphasised when count=0 so it doesn't draw attention
 * when there's nothing to stop.
 */
export function StopAllWorkhorsesButton({ count }: Props) {
  const disabled = count === 0;
  return (
    <form
      action={stopAllWorkhorsesAction}
      onSubmit={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        const ok = window.confirm(
          `Stop all ${count} registered workhorse(s)?\n\n` +
            `Each one's tmux session is killed on the target host on the next sync tick, ` +
            `and the project is removed from that host's local config.json. ` +
            `Workhorse rows are unregistered from the dashboard immediately.\n\n` +
            `Other tmux sessions on those hosts (sd-sync, anything not registered as a ` +
            `workhorse) are unaffected.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <button
        type="submit"
        disabled={disabled}
        className="button buttonSecondary"
        style={{
          padding: "4px 10px",
          fontSize: 12,
          color: disabled ? "var(--faint)" : "var(--red, #c0322a)",
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
        title={
          disabled
            ? "No registered workhorses to stop."
            : `Queue stop_session directives + unregister all ${count} workhorse rows.`
        }
      >
        {disabled
          ? "Stop all workhorses (none)"
          : `Stop all workhorses (${count})`}
      </button>
    </form>
  );
}
