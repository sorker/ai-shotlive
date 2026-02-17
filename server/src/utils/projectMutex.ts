/**
 * Per-project save mutex
 *
 * Serializes concurrent save operations for the same project,
 * preventing MySQL lock wait timeout errors caused by overlapping
 * long-running transactions on the same rows.
 *
 * Uses an in-memory Map of Promise chains keyed by "userId:projectId".
 * Each new save waits for the previous save to complete before starting.
 * Idle entries are cleaned up automatically.
 */

const locks = new Map<string, Promise<void>>();

/**
 * Execute a function while holding a per-project mutex.
 * Concurrent calls for the same (userId, projectId) will be serialized.
 */
export async function withProjectLock<T>(
  userId: number,
  projectId: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = `${userId}:${projectId}`;

  // Wait for any pending operation on this project to finish
  const prev = locks.get(key) ?? Promise.resolve();

  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  locks.set(key, next);

  try {
    await prev;
    return await fn();
  } finally {
    resolve!();
    // Clean up if this is still the latest entry
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  }
}
