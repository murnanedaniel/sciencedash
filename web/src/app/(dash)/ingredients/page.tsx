import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { IngredientCategory, IngredientResult } from "@/generated/prisma/client";
import {
  upsertIngredient,
  attachIngredient,
  detachIngredient,
} from "@/lib/server/ingredientActions";

export default async function IngredientsPage() {
  const ingredients = await prisma.ingredient.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });
  const hypotheses = await prisma.hypothesis.findMany({
    include: {
      project: { select: { id: true, title: true } },
      ingredients: { include: { ingredient: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Build cell: category x project -> aggregate result
  const cells = new Map<string, { result: IngredientResult | "empty"; variants: string[]; hypotheses: string[] }>();
  for (const h of hypotheses) {
    for (const hi of h.ingredients) {
      const key = `${hi.ingredient.category}::${h.project.id}`;
      const entry = cells.get(key) ?? {
        result: "empty" as IngredientResult | "empty",
        variants: [] as string[],
        hypotheses: [] as string[],
      };
      // Aggregate: if existing differs, mark mixed.
      if (entry.result === "empty") entry.result = hi.result;
      else if (entry.result !== hi.result) entry.result = "mixed";
      if (hi.variant) entry.variants.push(hi.variant);
      entry.hypotheses.push(h.id);
      cells.set(key, entry);
    }
  }

  function cellClass(r: IngredientResult | "empty") {
    switch (r) {
      case "supported":
        return "cellSupported";
      case "refuted":
        return "cellRefuted";
      case "mixed":
        return "cellMixed";
      case "pending":
        return "cellPending";
      default:
        return "cellEmpty";
    }
  }

  function symbol(r: IngredientResult | "empty") {
    switch (r) {
      case "supported":
        return "✓";
      case "refuted":
        return "✗";
      case "mixed":
        return "±";
      case "pending":
        return "·";
      default:
        return "";
    }
  }

  // Group rows by category
  const rowsByCategory = new Map<IngredientCategory, typeof ingredients>();
  for (const ing of ingredients) {
    const k = ing.category;
    const arr = rowsByCategory.get(k) ?? [];
    arr.push(ing);
    rowsByCategory.set(k, arr);
  }

  return (
    <div className="container">
      <header className="pageHead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="pageTitle">Ingredients</h1>
          <p className="pageSub">
            Brand-free grid scan (§6.2, §6.4). Rows are ingredient categories; columns are projects.
          </p>
        </div>
        <a className="button buttonSecondary" href="/ingredients/export">Export as Markdown</a>
      </header>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Category</th>
              {projects.map((p) => (
                <th key={p.id}>
                  <Link className="link" href={`/projects/${p.id}`}>
                    {p.title}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.values(IngredientCategory).map((cat) => {
              return (
                <tr key={cat}>
                  <td className="rowLabel">{cat.replace("_", " ")}</td>
                  {projects.map((p) => {
                    const cell = cells.get(`${cat}::${p.id}`);
                    const r = cell?.result ?? "empty";
                    return (
                      <td key={p.id} className={cellClass(r)} title={cell?.variants.join(", ")}>
                        {symbol(r)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Attach to hypothesis */}
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="sectionTitle">Attach ingredient to hypothesis</h2>
        <form action={attachIngredient} className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="field" style={{ minWidth: 260 }}>
            <label>Hypothesis</label>
            <select name="hypothesisId" required>
              <option value="">Pick…</option>
              {hypotheses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.project.title} — {h.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 240 }}>
            <label>Ingredient</label>
            <select name="ingredientId" required>
              <option value="">Pick…</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.category.replace("_", " ")} — {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label>Variant</label>
            <input name="variant" placeholder="e.g. block-sparse-16" />
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label>Result</label>
            <select name="result" defaultValue="pending">
              {Object.values(IngredientResult).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <button className="button" type="submit">Attach</button>
        </form>
      </div>

      {/* Ingredient library editor */}
      <div className="card" style={{ marginTop: 18 }}>
        <h2 className="sectionTitle">Ingredient library</h2>
        <form action={upsertIngredient} className="row" style={{ flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label>Category</label>
            <select name="category">
              {Object.values(IngredientCategory).map((c) => (
                <option key={c} value={c}>{c.replace("_", " ")}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 260 }}>
            <label>Name</label>
            <input name="name" placeholder="e.g. block-sparse attention" required />
          </div>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label>Description</label>
            <input name="description" />
          </div>
          <button className="button" type="submit">Add / update</button>
        </form>
        <table className="metricTable">
          <thead>
            <tr>
              <th>Category</th>
              <th>Name</th>
              <th>Description</th>
              <th>Attached to</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((i) => {
              const attached = hypotheses
                .flatMap((h) => h.ingredients.filter((hi) => hi.ingredientId === i.id).map((hi) => ({ h, hi })))
                .map((x) => `${x.h.project.title}/${x.h.title}${x.hi.variant ? ` [${x.hi.variant}]` : ""}`);
              return (
                <tr key={i.id}>
                  <td>{i.category.replace("_", " ")}</td>
                  <td>{i.name}</td>
                  <td>{i.description ?? "—"}</td>
                  <td style={{ fontSize: 11 }}>{attached.length ? attached.join(" · ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detach form */}
      {hypotheses.some((h) => h.ingredients.length > 0) ? (
        <div className="card" style={{ marginTop: 18 }}>
          <h2 className="sectionTitle">Detach an ingredient</h2>
          <form action={detachIngredient} className="row" style={{ gap: 10 }}>
            <select name="hypothesisId" required>
              <option value="">Hypothesis…</option>
              {hypotheses.map((h) => (
                <option key={h.id} value={h.id}>{h.project.title} — {h.title}</option>
              ))}
            </select>
            <select name="ingredientId" required>
              <option value="">Ingredient…</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <button className="button buttonSecondary" type="submit">Detach</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
