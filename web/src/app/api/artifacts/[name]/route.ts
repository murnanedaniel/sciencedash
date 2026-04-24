import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACTS_DIR } from "@/lib/server/artifacts";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[a-z0-9-]+(\.[a-z0-9]+)?$/i.test(name)) {
    return new Response("bad name", { status: 400 });
  }
  const path = join(ARTIFACTS_DIR, name);
  try {
    await stat(path);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const buf = await readFile(path);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const type = TYPES[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
