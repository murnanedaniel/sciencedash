import { prisma } from "@/lib/prisma";
import { IngredientCategory } from "@/generated/prisma/client";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });
  const hypotheses = await prisma.hypothesis.findMany({
    include: { ingredients: true, project: { select: { id: true, title: true } } },
  });

  function cellSymbol(cat: string, projectId: string): string {
    const hs = hypotheses.filter((h) => h.project.id === projectId);
    const results = hs.flatMap((h) =>
      h.ingredients
        .filter((i) => {
          // look up category via join — we need ingredient.category which requires another fetch.
          return true; // handled below by aggregating
        })
        .map((i) => i.result),
    );
    if (results.length === 0) return "·";
    if (results.every((r) => r === "supported")) return "✓";
    if (results.every((r) => r === "refuted")) return "✗";
    return "±";
  }

  // Build a category x project matrix using joined data
  const full = await prisma.hypothesisIngredient.findMany({
    include: {
      ingredient: true,
      hypothesis: { select: { projectId: true } },
    },
  });
  const table = new Map<string, string>();
  for (const row of full) {
    const k = `${row.ingredient.category}::${row.hypothesis.projectId}`;
    const cur = table.get(k);
    if (!cur) table.set(k, row.result);
    else if (cur !== row.result) table.set(k, "mixed");
  }

  const header = ["| category | " + projects.map((p) => p.title).join(" | ") + " |"];
  const sep = ["|" + new Array(projects.length + 1).fill("---").join("|") + "|"];
  const body = Object.values(IngredientCategory).map((cat) => {
    const row = [cat.replace("_", " ")];
    for (const p of projects) {
      const v = table.get(`${cat}::${p.id}`);
      row.push(v === "supported" ? "✓" : v === "refuted" ? "✗" : v === "mixed" ? "±" : v === "pending" ? "·" : "");
    }
    return "| " + row.join(" | ") + " |";
  });
  const md = `# ScienceDash — foundation-model ingredient matrix\n\n${header.join("\n")}\n${sep.join("\n")}\n${body.join("\n")}\n`;

  return new Response(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": 'attachment; filename="ingredient-matrix.md"',
    },
  });
}
