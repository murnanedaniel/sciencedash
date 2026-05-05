/**
 * App-level auth primitives. Used by `proxy.ts`, `/api/auth/*`, and
 * anywhere else that needs to verify a request.
 *
 * Two trust paths:
 *   1. Bearer token (machines: sync.py, workhorse Claude MCP calls).
 *      Literal compare against `SCIENCEDASH_AUTH_TOKEN`.
 *   2. Signed session cookie (browsers). HMAC-SHA256 over
 *      "<userId>.<expiresAt>" with `SCIENCEDASH_SESSION_SECRET`.
 *
 * Design choices (see plan):
 * - 365-day cookie TTL, sliding window: any authenticated request that
 *   has consumed >7 days of its lifetime gets a fresh 365-day cookie.
 *   Net effect: log in once per device, never again unless explicitly
 *   logged out / SESSION_SECRET rotated / app unused for >365 days.
 * - All compares constant-time via `timingSafeEqual`.
 * - No DB session table; cookies are stateless. Logout = clear cookie.
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";

export const COOKIE_NAME = "sd-session";
export const COOKIE_TTL_SEC = 365 * 24 * 60 * 60;
/** Refresh threshold: re-issue cookie once this much time has elapsed. */
const COOKIE_REFRESH_AFTER_SEC = 7 * 24 * 60 * 60;

export type Session = { userId: string; expiresAt: number };

function readSecret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

export function signSession(
  userId: string = "user",
  ttlSec: number = COOKIE_TTL_SEC,
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${userId}.${expiresAt}`;
  const sig = createHmac("sha256", readSecret("SCIENCEDASH_SESSION_SECRET"))
    .update(payload)
    .digest();
  return `${payload}.${sig.toString("base64url")}`;
}

export function verifySession(cookieValue: string | undefined | null): Session | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtStr, sigB64] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt)) return null;
  if (expiresAt * 1000 < Date.now()) return null;
  const expectedSig = createHmac(
    "sha256",
    readSecret("SCIENCEDASH_SESSION_SECRET"),
  )
    .update(`${userId}.${expiresAt}`)
    .digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (actualSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(actualSig, expectedSig)) return null;
  return { userId, expiresAt };
}

/**
 * True when the session has consumed enough of its lifetime that we
 * should re-issue it with a fresh 365-day expiry. Equivalent to
 * "issuedAt < now - 7d", but expressed via expiresAt since we don't
 * store issuedAt.
 */
export function shouldRefreshSession(session: Session): boolean {
  const now = Math.floor(Date.now() / 1000);
  const remainingSec = session.expiresAt - now;
  return remainingSec < COOKIE_TTL_SEC - COOKIE_REFRESH_AFTER_SEC;
}

export function verifyBearer(authHeader: string | undefined | null): boolean {
  if (!authHeader) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return false;
  const provided = Buffer.from(m[1], "utf8");
  const expected = Buffer.from(readSecret("SCIENCEDASH_AUTH_TOKEN"), "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Constant-time password check against
 * sha256(plaintext + SCIENCEDASH_PASSWORD_SALT) compared to
 * SCIENCEDASH_AUTH_PASSWORD_HASH (hex).
 *
 * sha256 is overkill against a leaked .env (the salt + hash live next
 * to each other, so an attacker with the file can already brute-force
 * any reasonable password). The hashing is here to keep the plaintext
 * out of process listings, env dumps, and accidental log output.
 */
export function verifyPassword(plaintext: string): boolean {
  if (!plaintext) return false;
  const salt = readSecret("SCIENCEDASH_PASSWORD_SALT");
  const expectedHashHex = readSecret("SCIENCEDASH_AUTH_PASSWORD_HASH");
  const actualHashHex = createHash("sha256")
    .update(plaintext + salt)
    .digest("hex");
  const a = Buffer.from(actualHashHex, "hex");
  const e = Buffer.from(expectedHashHex.toLowerCase(), "hex");
  if (a.length !== e.length || a.length === 0) return false;
  return timingSafeEqual(a, e);
}
