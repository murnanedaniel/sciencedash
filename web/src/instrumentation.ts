export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SCIENCEDASH_WORKER === "0") {
    console.log("ScienceDash background worker disabled (SCIENCEDASH_WORKER=0)");
    return;
  }
  const { startWorker } = await import("@/lib/worker");
  startWorker();
}
