"use client";

import { removeWorkhorseAction } from "@/lib/server/agentMessageActions";

type Props = {
  workhorseId: string;
  host: string;
  sessionName: string;
};

/**
 * Remove button for a workhorse row. Wraps the server action in a
 * native confirm() dialog so the user has to acknowledge what's about
 * to happen on the target host. Pure client-side wrapper — the action
 * itself runs server-side via the form's action prop.
 */
export function RemoveWorkhorseButton({
  workhorseId,
  host,
  sessionName,
}: Props) {
  return (
    <form
      action={removeWorkhorseAction}
      onSubmit={(e) => {
        const ok = window.confirm(
          `Remove workhorse ${host}:${sessionName}?\n\n` +
            `This queues a stop_session directive that, on the next sync tick:\n` +
            `  • kills the tmux session on ${host}\n` +
            `  • removes this project from that host's ~/.sciencedash/config.json\n\n` +
            `The Workhorse row is unregistered from the dashboard immediately. ` +
            `Other workhorses on the same host (for other projects) are unaffected.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="workhorseId" value={workhorseId} />
      <button
        type="submit"
        className="button buttonSecondary small"
        style={{
          padding: "2px 8px",
          fontSize: 11,
          color: "var(--red, #c0322a)",
        }}
        title={
          `Stop the tmux session on ${host}, remove the project from ` +
          `that host's config.json, and unregister the row from the dashboard.`
        }
      >
        Remove
      </button>
    </form>
  );
}
