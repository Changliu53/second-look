/**
 * Like Promise.all over `items.map(fn)`, with at most `limit` calls running
 * at once. Results keep the order of `items`. Used for per-repository GitHub
 * lookups: one at a time is slow for someone with many repositories, and all
 * at once can trip GitHub's secondary rate limits.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker);
  await Promise.all(workers);
  return results;
}
