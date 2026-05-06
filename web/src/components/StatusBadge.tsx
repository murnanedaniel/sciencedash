import type { ProjectStatus } from "@/generated/prisma/client";

type Props = {
  status: ProjectStatus;
  blockers: string | null;
};

/**
 * Project status pill. For status="blocked", uses an amber colour and
 * surfaces the blocker reason inline (truncated, full text in title).
 * Other statuses render as the plain muted pill the rest of the app
 * has used since day one.
 */
export function StatusBadge({ status, blockers }: Props) {
  if (status === "blocked") {
    const text = blockers?.trim();
    return (
      <span
        className="row"
        style={{ gap: 6, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}
      >
        <span
          className="pill"
          style={{
            background: "var(--accent2, #b08a3a)",
            color: "#fff",
            flex: "0 0 auto",
          }}
          title={text || "blocked (no reason given)"}
        >
          blocked
        </span>
        {text ? (
          <span
            className="muted small"
            title={text}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {text}
          </span>
        ) : null}
      </span>
    );
  }
  return <span className="pill pillMuted">{status}</span>;
}
