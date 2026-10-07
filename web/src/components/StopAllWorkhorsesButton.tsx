"use client";

import { stopAllWorkhorsesAction } from "@/lib/server/agentMessageActions";

export function StopAllWorkhorsesButton({ count }: { count: number }) {
  return (
    <form action={stopAllWorkhorsesAction} onSubmit={(e) => {
      if (!count || !window.confirm(`Pause automated wakes and ticks for all ${count} workhorses? Running Claude turns may finish.`)) e.preventDefault();
    }}>
      <button type="submit" disabled={!count} className="button buttonSecondary">
        Stop all workhorses ({count || "none"})
      </button>
    </form>
  );
}
