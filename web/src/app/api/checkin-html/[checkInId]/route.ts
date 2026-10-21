import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { checkInHtmlFilePath, posterHeaders } from "@/lib/server/posters";

export const dynamic = "force-dynamic";

// Cookie/bearer authentication is enforced by src/proxy.ts.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ checkInId: string }> },
) {
  const { checkInId } = await params;
  if (!/^[a-z0-9_-]+$/i.test(checkInId)) {
    return new Response("not found", { status: 404 });
  }
  const checkIn = await prisma.checkIn.findUnique({
    where: { id: checkInId },
    select: { htmlPath: true },
  });
  if (!checkIn?.htmlPath) return new Response("not found", { status: 404 });
  try {
    // Derive the path rather than trusting a path stored in the database.
    const html = await readFile(checkInHtmlFilePath(checkInId));
    return new Response(new Uint8Array(html), { headers: posterHeaders() });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Response("not found", { status: 404 });
    }
    throw error;
  }
}
