import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const heartbeat = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,40}$/),
  envId: z.string().optional(),
  node: z.string().optional(),
  jobId: z.string().optional(),
  rcAlive: z.boolean(),
  claudeVersion: z.string().optional(),
  liveSessions: z.array(z.string()).max(200).optional(),
});

// Authentication uses proxy.ts's verifyBearer path, like the ambient ingest endpoints.
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = heartbeat.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid heartbeat", details: parsed.error.issues }, { status: 400 });
  }
  const { name, liveSessions, ...fields } = parsed.data;
  const data = {
    ...fields,
    liveSessions: JSON.stringify(liveSessions ?? []),
    lastBeat: new Date(),
    configJson: JSON.stringify(raw),
  };
  await prisma.bridge.upsert({ where: { name }, create: { name, ...data }, update: data });
  return NextResponse.json({ ok: true });
}
