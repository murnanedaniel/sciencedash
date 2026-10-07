"use client";

import { removeWorkhorseAction } from "@/lib/server/agentMessageActions";

export function RemoveWorkhorseButton({ workhorseId, bridgeName }: { workhorseId: string; bridgeName: string }) {
  return (
    <form action={removeWorkhorseAction} onSubmit={(e) => {
      if (!window.confirm(`Unregister workhorse on ${bridgeName}? The remote session stays open.`)) e.preventDefault();
    }}>
      <input type="hidden" name="workhorseId" value={workhorseId} />
      <button type="submit" className="button buttonSecondary small">Remove</button>
    </form>
  );
}
