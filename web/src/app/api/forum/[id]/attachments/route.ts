/**
 * POST /api/forum/[id]/attachments — upload one forum attachment.
 *
 * The 10 MB ceiling matches the auth proxy's request-body buffer; larger
 * bodies can be truncated before reaching this handler. Files live under the
 * ScienceDash state directory rather than a linked repository so uploads
 * never dirty or mutate research working copies.
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { forumEnabled } from "@/lib/config";
import {
  announceAttachment,
  forumAttachmentsDir,
} from "@/lib/forum/sessions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!forumEnabled()) {
    return jsonError(404, "forum disabled");
  }

  const { id } = await params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "upload failed — files must be under 10 MB");
  }

  const value = form.get("file");
  if (!(value instanceof File) || value.size <= 0) {
    return jsonError(400, "file is required");
  }
  if (value.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, "file must be under 10 MB");
  }

  const forum = await prisma.forum.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!forum || forum.status === "ended") {
    return jsonError(404, "no such active forum");
  }

  let name = basename(value.name)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  if (!name) name = "file";
  if (name.startsWith(".")) name = `_${name}`;

  const dir = forumAttachmentsDir(id);
  await mkdir(dir, { recursive: true });
  let path = join(dir, name);
  try {
    await access(path);
    name = `${Date.now()}-${name}`;
    path = join(dir, name);
  } catch {
    // The original name is available.
  }

  await writeFile(path, Buffer.from(await value.arrayBuffer()));
  await announceAttachment(id, name, path, value.size);

  return Response.json(
    { attachment: { name, path, size: value.size } },
    { status: 201 },
  );
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
