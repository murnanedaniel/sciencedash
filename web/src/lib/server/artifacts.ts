import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ARTIFACTS_DIR = join(process.cwd(), ".data", "artifacts");

export async function storeArtifactFile(file: File): Promise<{
  path: string;
  size: number;
}> {
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = extOf(file.name);
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const suffix = randomBytes(3).toString("hex");
  const filename = `${hash}-${suffix}${ext ? "." + ext : ""}`;
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const abs = join(ARTIFACTS_DIR, filename);
  await writeFile(abs, buf);
  return { path: `/api/artifacts/${filename}`, size: buf.length };
}

function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return null;
  return ext;
}
