import { headers } from "next/headers";

/**
 * Resolve the public origin (scheme + host) the dashboard is reachable
 * at, suitable for embedding into MCP-client configs and bootstrap
 * scripts that will run on the user's local machine.
 *
 * Order of preference:
 *   1. SCIENCEDASH_BASE_URL env (canonical for the homebox)
 *   2. X-Forwarded-{Host,Proto} headers set by the reverse proxy
 *      (cloudflared / Tailscale Funnel)
 *   3. Host header
 *
 * Mirrors the public-host logic used for redirects in
 * `web/src/lib/auth.ts:buildRedirectURL`. Lifted out of the brain-chat
 * page so non-page callers (API routes) can use it too.
 */
export async function resolveDashboardOrigin(): Promise<string> {
  const env = process.env.SCIENCEDASH_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
