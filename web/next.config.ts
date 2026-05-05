import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // When running `next dev` behind a reverse proxy (Tailscale Funnel,
  // cloudflared) the dev server sees requests with a non-localhost
  // Origin/Host. Next.js 16 wants these allowlisted so server actions
  // and HMR work across the proxy hop.
  //
  // Comma-separated SCIENCEDASH_ALLOWED_DEV_ORIGINS lets each deployment
  // (laptop dev / homebox / future hosts) extend the list without code
  // edits.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    ...(process.env.SCIENCEDASH_ALLOWED_DEV_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []),
  ],
};

export default nextConfig;
