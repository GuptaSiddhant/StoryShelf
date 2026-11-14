/** Network quiet from the driver's request events: the switch's stand-in for a load's wait. */

/** How long the page must have no request in flight before a switched story counts as loaded. */
export const QUIET_MS = 500;

/** The part of a page this needs: its request events. */
export interface RequestEvents {
  on(
    event: "request" | "requestfinished" | "requestfailed",
    listener: (request: unknown) => void,
  ): unknown;
  off(
    event: "request" | "requestfinished" | "requestfailed",
    listener: (request: unknown) => void,
  ): unknown;
}

/** Counts a page's requests in flight from the moment it is created until `dispose`. */
export interface RequestTracker {
  /**
   * Resolve true once nothing has been in flight for `quietMs`, counted from the last request
   * to start or end (so a page that went quiet long ago does not wait again), or false when
   * `timeoutMs` passes first (a story that keeps polling never goes quiet).
   */
  quiet(quietMs: number, timeoutMs: number): Promise<boolean>;
  dispose(): void;
}

/** Start counting requests on `page`. */
export function trackRequests(page: RequestEvents, now: () => number = Date.now): RequestTracker {
  const inFlight = new Set<unknown>();
  let changedAt = now();
  const started = (request: unknown): void => {
    inFlight.add(request);
    changedAt = now();
  };
  const ended = (request: unknown): void => {
    inFlight.delete(request);
    changedAt = now();
  };
  page.on("request", started);
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  return {
    quiet: async (quietMs, timeoutMs) => {
      const deadline = now() + timeoutMs;
      while (inFlight.size > 0 || now() - changedAt < quietMs) {
        if (now() >= deadline) return false;
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling the counted state
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 25);
        });
      }
      return true;
    },
    dispose: () => {
      page.off("request", started);
      page.off("requestfinished", ended);
      page.off("requestfailed", ended);
    },
  };
}
