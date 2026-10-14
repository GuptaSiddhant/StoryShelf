/** Split `items` into consecutive batches of at most `size` (a non-positive size means one batch). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = size > 0 ? Math.max(1, Math.floor(size)) : items.length || 1;
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += step) {
    batches.push(items.slice(start, start + step));
  }
  return batches;
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      // oxlint-disable-next-line eslint/no-await-in-loop -- bounded worker pulls sequentially
      results[index] = await fn(items[index] as T, index);
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      await worker();
    }),
  );
  return results;
}
