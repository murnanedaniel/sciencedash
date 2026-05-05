import { NextRequest, NextResponse } from "next/server";
import {
  buildRedirectURL,
  COOKIE_NAME,
  COOKIE_TTL_SEC,
  signSession,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login — validates the form's `password` field, sets a
 * 365-day session cookie on success, and 303-redirects back to the
 * `next` field (validated as a same-origin path). On failure, redirects
 * back to /login?error=1 preserving `next`.
 *
 * The proxy allows this path through unauthenticated.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const rawNext = String(form.get("next") ?? "/");
  // Same-origin path only — no protocol-relative or absolute URLs.
  const safeNext =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!verifyPassword(password)) {
    const target = buildRedirectURL(
      req,
      `/login?error=1&next=${encodeURIComponent(safeNext)}`,
    );
    return NextResponse.redirect(target, { status: 303 });
  }

  const target = buildRedirectURL(req, safeNext);
  const res = NextResponse.redirect(target, { status: 303 });
  res.cookies.set({
    name: COOKIE_NAME,
    value: signSession(),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_SEC,
  });
  return res;
}
