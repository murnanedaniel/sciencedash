import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await prisma.jobRun.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Parse the JSONL log into an array for the client.
  const messages: unknown[] = [];
  if (job.messagesJson) {
    for (const line of job.messagesJson.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        messages.push(JSON.parse(t));
      } catch {
        // skip malformed line
      }
    }
  }

  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    title: job.title,
    projectId: job.projectId,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    ok: job.ok,
    error: job.error,
    costUsd: job.costUsd,
    messages,
  });
}
