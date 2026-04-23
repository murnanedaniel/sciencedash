export function parseTags(input: string): string[] {
  /**
   * Parse a comma/whitespace separated tag string into normalized unique tags.
   * Input: "tracking,  HL-LHC  ,  misalignment"
   * Output: ["tracking","hl-lhc","misalignment"]
   */
  const raw = input
    .split(/[,\n]/g)
    .flatMap((chunk) => chunk.split(/\s+/g))
    .map((t) => t.trim())
    .filter(Boolean);

  const normalized = raw
    .map((t) => t.toLowerCase())
    .map((t) => t.replace(/[^a-z0-9._-]+/g, "-"))
    .map((t) => t.replace(/-+/g, "-"))
    .map((t) => t.replace(/^-|-$/g, ""))
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

