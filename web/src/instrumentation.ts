export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("@/lib/worker");
  startWorker();
  const { ensureIngredientSeed } = await import("@/lib/ingredientSeed");
  try {
    await ensureIngredientSeed();
  } catch {
    /* non-fatal on boot */
  }
}
