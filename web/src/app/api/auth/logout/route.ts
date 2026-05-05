import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — clears the session cookie and 303-redirects
 * back to /login. Allowed through the proxy unauthenticated so a
 * stale-cookie session can still log out without first re-authing.
 */
export async function POST(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url, { status: 303 });
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
