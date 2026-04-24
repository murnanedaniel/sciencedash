import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";

// Render the top-level README.md (sibling of web/) into HTML on demand.
// Read at request time so doc edits show up without a rebuild.
export async function GET() {
  const path = join(process.cwd(), "..", "README.md");
  let md: string;
  try {
    md = await readFile(path, "utf8");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return new Response(
      `<p>README not found: <code>${err}</code></p>`,
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
  const html = await marked.parse(md, { gfm: true });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=60",
    },
  });
}
