import { NextRequest, NextResponse } from "next/server";
import { buildRedirectURL, COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — clears the session cookie and 303-redirects
 * back to /login. Allowed through the proxy unauthenticated so a
 * stale-cookie session can still log out without first re-authing.
 */
export async function POST(req: NextRequest) {
  const target = buildRedirectURL(req, "/login");
  const res = NextResponse.redirect(target, { status: 303 });
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
