export type ArxivMeta = {
  arxivId: string;
  title: string;
  authors: string;
  abstract: string;
};

export function extractArxivId(input: string): string | null {
  const m = input.match(/(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})/i);
  return m ? m[1]! : null;
}

/**
 * Fetch arXiv metadata via the Atom API. No auth required.
 */
export async function fetchArxivMeta(arxivId: string): Promise<ArxivMeta | null> {
  const r = await fetch(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
    { headers: { accept: "application/atom+xml" } },
  );
  if (!r.ok) return null;
  const xml = await r.text();
  // Extremely small XML parse — we only need title, authors, summary.
  const title = textBetween(xml, "<entry>", "</entry>", "<title>", "</title>")
    ?.replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  const abstract = textBetween(xml, "<entry>", "</entry>", "<summary>", "</summary>")
    ?.replace(/\s+/g, " ")
    .trim();
  const entry = xml.split("<entry>")[1]?.split("</entry>")[0] ?? "";
  const authors = Array.from(entry.matchAll(/<name>([^<]+)<\/name>/g))
    .map((m) => m[1]!.trim())
    .join(", ");
  return {
    arxivId,
    title,
    authors,
    abstract: abstract ?? "",
  };
}

function textBetween(
  hay: string,
  entryOpen: string,
  entryClose: string,
  open: string,
  close: string,
): string | null {
  const entry = hay.split(entryOpen)[1]?.split(entryClose)[0];
  if (!entry) return null;
  const s = entry.indexOf(open);
  if (s === -1) return null;
  const e = entry.indexOf(close, s);
  if (e === -1) return null;
  return entry.slice(s + open.length, e);
}
