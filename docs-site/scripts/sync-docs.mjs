// Copy the canonical Markdown from ../docs into the Starlight content
// collection, adding the frontmatter Starlight needs. This keeps ../docs as
// the single source of truth (it's also rendered in-app at /docs) and avoids
// drift. Generated files are gitignored; the build runs this first.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, "..", "..", "docs");
const outDir = join(here, "..", "src", "content", "docs");

// source filename -> { out filename, fallback title, description }
const MAP = [
  {
    src: "tutorial.md",
    out: "tutorial.md",
    title: "How it works",
    description: "What ScienceDash is and how to use it end to end.",
  },
  {
    src: "setup-tutorial.md",
    out: "setup.md",
    title: "Project setup",
    description: "Onboarding a project: repo, metrics, ingest, workhorses.",
  },
  {
    src: "cluster-integration.md",
    out: "cluster-integration.md",
    title: "Remote workhorses",
    description: "Connecting remote Claude Code sessions on compute hosts.",
  },
  {
    src: "workhorse-protocol.md",
    out: "workhorse-protocol.md",
    title: "Workhorse protocol",
    description: "The sync.py wire protocol between dashboard and host.",
  },
];

function escapeYaml(s) {
  return s.replace(/"/g, '\\"');
}

await mkdir(outDir, { recursive: true });

for (const entry of MAP) {
  let body = await readFile(join(docsDir, entry.src), "utf-8");

  // The source docs link to the app's in-app routes (e.g. /docs renders
  // tutorial.md inside the dashboard). On the marketing site, point those at
  // the equivalent published page under the base path.
  body = body.replaceAll("](/docs)", "](/sciencedash/tutorial/)");

  // Use the first H1 as the page title (and strip it, so Starlight doesn't
  // render a second one). Fall back to the configured title.
  let title = entry.title;
  const m = body.match(/^#\s+(.+?)\s*$/m);
  if (m) {
    title = m[1];
    body = body.replace(m[0], "").replace(/^\s+/, "");
  }

  const frontmatter =
    `---\n` +
    `title: "${escapeYaml(title)}"\n` +
    `description: "${escapeYaml(entry.description)}"\n` +
    `---\n\n`;

  await writeFile(join(outDir, entry.out), frontmatter + body, "utf-8");
  console.log(`synced ${entry.src} -> ${entry.out} (${title})`);
}
