/**
 * Next.js 16 proxy (the renamed-in-v16 successor to middleware.ts).
 *
 * Gates every dashboard request: try Bearer header first (machine
 * path), then signed-cookie session (browser path). On miss:
 *   - Browsers (Accept: text/html) → 302 to /login?next=<original>.
 *   - Everyone else (API, fetch, curl) → 401 JSON.
 *
 * Public paths (login page, login/logout endpoints, static assets) are
 * allowed through unconditionally. The matcher excludes Next's static
 * asset routes; the explicit allowlist below covers the rest.
 *
 * Runtime: always Node.js in v16 (per Next.js 16 release notes — Edge
 * is no longer an option in proxy). We use `node:crypto` for HMAC.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_NAME,
  COOKIE_TTL_SEC,
  shouldRefreshSession,
  signSession,
  verifyBearer,
  verifySession,
} from "@/lib/auth";

const PUBLIC_EXACT: ReadonlySet<string> = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/favicon.ico",
  "/robots.txt",
]);

const PUBLIC_PREFIXES: ReadonlyArray<string> = [
  "/_next/", // covered by matcher too, but keep as defense-in-depth
  "/public/",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function wantsHtml(req: NextRequest): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // 1. Bearer (sync.py + workhorse Claudes via mcp-config headers).
  if (verifyBearer(request.headers.get("authorization"))) {
    return NextResponse.next();
  }

  // 2. Cookie (browsers, all dashboard pages + their server actions).
  const cookieValue = request.cookies.get(COOKIE_NAME)?.value;
  const session = verifySession(cookieValue);
  if (session) {
    const res = NextResponse.next();
    if (shouldRefreshSession(session)) {
      res.cookies.set({
        name: COOKIE_NAME,
        value: signSession(session.userId, COOKIE_TTL_SEC),
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_TTL_SEC,
      });
    }
    return res;
  }

  // 3. Unauthenticated.
  if (wantsHtml(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = {
  // Match everything except Next's own static asset routes. The
  // application-level allowlist (login, /api/auth, etc.) is enforced
  // inside `proxy` so the matcher can stay simple/readable.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
