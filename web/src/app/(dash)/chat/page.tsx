import { ChatClient } from "@/components/ChatClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /chat — the dashboard's primary entry point.
 *
 * Streams assistant turns from /api/chat/stream and renders tool calls
 * inline. Server component is intentionally bare: the whole UI lives in
 * the ChatClient client component so the streaming subscriber can run
 * in the browser without an extra round-trip.
 */
export default async function ChatPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const initial = typeof sp.q === "string" ? sp.q : Array.isArray(sp.q) ? sp.q[0] : "";

  return (
    <div className="container" style={{ maxWidth: 920 }}>
      <ChatClient initialMessage={initial ?? ""} />
    </div>
  );
}
