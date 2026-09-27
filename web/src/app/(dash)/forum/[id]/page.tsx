import { notFound } from "next/navigation";
import { ForumClient } from "@/components/ForumClient";
import { forumEnabled } from "@/lib/config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ForumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!forumEnabled()) notFound();

  const { id } = await params;
  const forum = await prisma.forum.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!forum) notFound();

  // Everything else (transcript, participants, live state) arrives over the
  // SSE snapshot, so the server component stays a thin existence check.
  return (
    <div className="container" style={{ maxWidth: 920 }}>
      <ForumClient forumId={forum.id} />
    </div>
  );
}
