import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { checkInHtmlUrl } from "@/lib/server/posters";

export default async function CheckInHtmlPage({ params }: { params: Promise<{ id: string; checkInId: string }> }) {
  const { id, checkInId } = await params;
  const checkIn = await prisma.checkIn.findUnique({ where: { id: checkInId } });
  if (!checkIn?.htmlPath || checkIn.projectId !== id) notFound();
  const src = checkInHtmlUrl(checkInId);
  const title = checkIn.htmlTitle ?? "Check-in attachment";

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <header className="rowWrap" style={{ padding: "10px 16px", gap: 12 }}>
        <Link className="link" href={`/projects/${id}`}>Back</Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>{title}</h1>
          <div className="muted small">{checkIn.createdAt.toISOString().slice(0, 10)}</div>
        </div>
        <a className="link" href={src} target="_blank" rel="noopener noreferrer">Open full screen</a>
      </header>
      <iframe
        src={src}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={title}
        style={{ flex: 1, minHeight: 0, width: "100%", border: 0 }}
      />
    </div>
  );
}
