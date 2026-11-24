/**
 * Async utilities: timeout racing and bounded-concurrency mapping.
 *
 * Kept dependency-free so both the agent runtime (call_llm) and the session
 * storage layer can share them without creating a package-level import cycle.
 */

/**
 * Race a promise against a timeout. Rejects with `new Error(message)` if `ms`
 * elapses first. The timer is always cleared when the race settles, so a fast
 * resolution never leaks a pending timer.
 *
 * Caveat: a timeout rejection abandons `promise` but cannot cancel the
 * underlying work — e.g. a libuv `fs` read keeps running on its threadpool
 * thread until the kernel returns. Callers racing a blocking read must ensure
 * that read can't starve a shared resource (the session loader skips
 * cloud-evicted files via metadata so this timeout is only a backstop).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer!));
}

/**
 * Map `fn` over `items` with at most `limit` calls in flight, preserving input
 * order in the result array. A fixed pool of workers pulls from a shared cursor,
 * so one slow item never blocks the others beyond the concurrency limit.
 *
 * `fn` is expected not to reject — callers that can fail should catch internally
 * and return a sentinel (e.g. `null`). A rejection from `fn` rejects the whole
 * map, matching `Promise.all` semantics.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
