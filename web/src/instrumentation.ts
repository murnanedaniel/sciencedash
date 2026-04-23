export async function register() {
  // Only the Node runtime should run the worker — skip on edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("@/lib/worker");
  startWorker();
}
