import { NextRequest, NextResponse } from "next/server";
import { extractArxivId, fetchArxivMeta } from "@/lib/ingest/arxiv";

export async function POST(req: NextRequest) {
  const { url } = (await req.json()) as { url: string };
  const id = url ? extractArxivId(url) : null;
  if (!id) return NextResponse.json({ error: "no arxiv id in url" }, { status: 400 });
  const meta = await fetchArxivMeta(id);
  if (!meta) return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  return NextResponse.json(meta);
}
