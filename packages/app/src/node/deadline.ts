/** Settle with `work`, or with `fallback` once `ms` have passed, whichever comes first. */
export async function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, ms), fallback);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Milliseconds left until `deadline` (an epoch time), never negative. */
export function remainingUntil(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}
