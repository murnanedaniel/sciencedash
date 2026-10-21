import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export const POSTERS_DIR =
  process.env.SCIENCEDASH_POSTERS_DIR ?? join(process.cwd(), ".data", "posters");
export const MAX_POSTER_BYTES = 2 * 1024 * 1024;

export function posterFilePath(noteId: string): string {
  if (!/^[a-z0-9_-]+$/i.test(noteId)) throw new Error("invalid noteId");
  return join(POSTERS_DIR, `${noteId}.html`);
}

export function posterUrl(noteId: string): string {
  return `/api/posters/${encodeURIComponent(noteId)}`;
}

export function checkInHtmlFilePath(checkInId: string): string {
  if (!/^[a-z0-9_-]+$/i.test(checkInId)) throw new Error("invalid checkInId");
  return join(POSTERS_DIR, "checkins", `${checkInId}.html`);
}

export function checkInHtmlUrl(checkInId: string): string {
  return `/api/checkin-html/${encodeURIComponent(checkInId)}`;
}

export async function storeCheckInHtml(checkInId: string, html: string): Promise<string> {
  validatePoster(html);
  return storeHtml(checkInHtmlFilePath(checkInId), html);
}

export async function removeCheckInHtml(checkInId: string): Promise<void> {
  await rm(checkInHtmlFilePath(checkInId), { force: true });
}

export function validatePoster(html: string): void {
  if (Buffer.byteLength(html, "utf8") > MAX_POSTER_BYTES) {
    throw new Error("poster must be at most 2 MB");
  }
  if (!/^(?:<!doctype html>|<html(?:\s|>))/i.test(html)) {
    throw new Error("poster must start with <!doctype html> or <html");
  }
  // Defence in depth only: these checks are not an HTML/JS sanitizer.
  // The response CSP sandbox and iframe sandbox are the security boundary.
  if (/<script\b[^>]*\bsrc\s*=|<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet)(?=[^>]*\bhref\s*=\s*["']?http)|fetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(|<iframe\b/i.test(html)) {
    throw new Error("poster contains external requests or embedded content");
  }
}

export async function readPosterInput(args: Record<string, unknown>): Promise<string> {
  if (("html" in args) === ("htmlPath" in args)) {
    throw new Error("provide exactly one of html or htmlPath");
  }
  let html: string;
  if ("html" in args) {
    if (typeof args.html !== "string") throw new Error("html must be a string");
    html = args.html;
  } else {
    if (typeof args.htmlPath !== "string" || !isAbsolute(args.htmlPath)) {
      throw new Error("htmlPath must be an absolute server path");
    }
    const file = await open(args.htmlPath, "r");
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error("htmlPath must be a regular file");
      if (info.size > MAX_POSTER_BYTES) throw new Error("poster must be at most 2 MB");
      // Bound the read even if the source grows after stat().
      const buffer = Buffer.alloc(MAX_POSTER_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_POSTER_BYTES) throw new Error("poster must be at most 2 MB");
      html = buffer.subarray(0, size).toString("utf8");
    } finally {
      await file.close();
    }
  }
  validatePoster(html);
  return html;
}

export async function storePoster(noteId: string, html: string): Promise<string> {
  validatePoster(html);
  return storeHtml(posterFilePath(noteId), html);
}

async function storeHtml(path: string, html: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, html, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

export function posterHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=60",
  };
}
