import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { posterFilePath, posterHeaders } from "@/lib/server/posters";

export const dynamic = "force-dynamic";

// Cookie/bearer authentication is enforced by src/proxy.ts.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const { noteId } = await params;
  if (!/^[a-z0-9_-]+$/i.test(noteId)) {
    return new Response("not found", { status: 404 });
  }
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { posterPath: true },
  });
  if (!note?.posterPath) return new Response("not found", { status: 404 });
  try {
    // Derive the path rather than trusting a path stored in the database.
    const html = await readFile(posterFilePath(noteId));
    return new Response(new Uint8Array(html), { headers: posterHeaders() });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Response("not found", { status: 404 });
    }
    throw error;
  }
}
