import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { posterUrl } from "@/lib/server/posters";

export default async function PosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note?.posterPath) notFound();
  const src = posterUrl(id);
  const paperUrl = note.url ?? (note.arxivId ? `https://arxiv.org/abs/${note.arxivId}` : null);

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <header className="rowWrap" style={{ padding: "10px 16px", gap: 12 }}>
        <Link className="link" href="/reading">Back</Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>{note.title}</h1>
          {note.authors ? <div className="muted small">{note.authors}</div> : null}
        </div>
        {paperUrl ? <a className="link" href={paperUrl} target="_blank" rel="noreferrer">Paper</a> : null}
        <a className="link" href={src} target="_blank" rel="noopener noreferrer">Open full screen</a>
      </header>
      <iframe
        src={src}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={`Super-poster: ${note.title}`}
        style={{ flex: 1, minHeight: 0, width: "100%", border: 0 }}
      />
    </div>
  );
}
