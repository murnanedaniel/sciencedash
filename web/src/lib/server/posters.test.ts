import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_POSTER_BYTES, posterFilePath, posterHeaders, readPosterInput, validatePoster } from "./posters";

const minimal = "<!doctype html><html><body><h1>Paper</h1><script>document.title = 'Paper';</script></body></html>";

test("attach_poster accepts minimal HTML and case-insensitive prefixes", async () => {
  assert.equal(await readPosterInput({ html: minimal }), minimal);
  assert.doesNotThrow(() => validatePoster("<HTML><body>Paper</body></HTML>"));
});

test("attach_poster rejects oversized UTF-8 content and non-HTML", () => {
  assert.throws(() => validatePoster("<html>" + "x".repeat(MAX_POSTER_BYTES)), /2 MB/);
  assert.throws(() => validatePoster("<html>" + "é".repeat(MAX_POSTER_BYTES / 2)), /2 MB/);
  assert.throws(() => validatePoster("plain text"), /must start/);
});

test("attach_poster rejects external resource and network patterns", () => {
  for (const content of [
    '<script src="https://example.com/a.js"></script>',
    "<script>fetch('/api/notes')</script>",
    '<SCRIPT SRC = "/a.js"></SCRIPT>',
    '<link rel="stylesheet" href="https://example.com/a.css">',
    "<script>new XMLHttpRequest()</script>",
    "<script>new WebSocket('wss://example.com')</script>",
    "<script>import('/a.js')</script>",
    '<iframe src="/"></iframe>',
  ]) {
    assert.throws(() => validatePoster("<!doctype html>" + content), /external requests/);
  }
});

test("attach_poster requires exactly one input and an absolute file path", async () => {
  await assert.rejects(readPosterInput({}), /exactly one/);
  await assert.rejects(readPosterInput({ html: minimal, htmlPath: "/a.html" }), /exactly one/);
  await assert.rejects(readPosterInput({ htmlPath: "a.html" }), /absolute/);
  await assert.rejects(readPosterInput({ html: 42 }), /string/);
  assert.throws(() => posterFilePath("../escape"), /invalid noteId/);
});

test("attach_poster validates server files with the same size and content rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sd-poster-test-"));
  const path = join(dir, "poster.html");
  try {
    await writeFile(path, minimal);
    assert.equal(await readPosterInput({ htmlPath: path }), minimal);
    await writeFile(path, "not HTML");
    await assert.rejects(readPosterInput({ htmlPath: path }), /must start/);
    await writeFile(path, "x".repeat(MAX_POSTER_BYTES + 1));
    await assert.rejects(readPosterInput({ htmlPath: path }), /2 MB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("poster headers sandbox direct navigation and prohibit external requests", () => {
  assert.deepEqual(posterHeaders(), {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=60",
  });
});
