/** Tiny per-key mutex so a tick can't overlap itself. */
const held = new Map<string, Promise<void>>();

export async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (held.has(key)) return null; // already running — skip this tick
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  held.set(key, gate);
  try {
    return await fn();
  } finally {
    held.delete(key);
    release();
  }
}
