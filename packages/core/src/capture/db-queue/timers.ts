/** Timer seam of the database queue: production uses the global timers, tests a manual clock. */

/** The two timer calls the queue, its wake signal and the lease keeper make. */
export interface QueueTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Global timers, unref'd so a waiting poll or a lease check never holds the process open. */
export const REAL_TIMERS: QueueTimers = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, Math.max(0, ms));
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** Call `callback` every `ms` until the returned stop function runs; built on `setTimeout`. */
export function repeatEvery(timers: QueueTimers, ms: number, callback: () => void): () => void {
  let handle: unknown;
  let stopped = false;
  const arm = (): void => {
    handle = timers.setTimeout(() => {
      if (!stopped) {
        callback();
        arm();
      }
    }, ms);
  };
  arm();
  return () => {
    stopped = true;
    timers.clearTimeout(handle);
  };
}
