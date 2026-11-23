/** In-process wake signal: an enqueue on this instance wakes its waiting poller at once. */
import { REAL_TIMERS, type QueueTimers } from "./timers.ts";

/** Wakes waiters on local enqueue; other instances find the job on their next poll. */
export interface WakeSignal {
  /** Wake every current waiter. */
  notify(): void;
  /** Count of notifies so far; pass it to `wait` to catch a notify that came before the wait. */
  version(): number;
  /**
   * Resolve true when notified, false after `ms` or once closed. With `since`, resolve true at once
   * if a notify came after that version was read (no lost wake-up between a probe and its wait).
   */
  wait(ms: number, since?: number): Promise<boolean>;
  /** Release every waiter (false) and make later waits resolve at once; idempotent. */
  close(): void;
}

/** Create a wake signal over `timers` (unref'd globals by default). */
export function createWakeSignal(timers: QueueTimers = REAL_TIMERS): WakeSignal {
  const waiters = new Set<(woken: boolean) => void>();
  let closed = false;
  let notifies = 0;
  const settleAll = (woken: boolean): void => {
    for (const settle of waiters) {
      settle(woken);
    }
    waiters.clear();
  };
  return {
    notify: () => {
      notifies += 1;
      settleAll(true);
    },
    version: () => notifies,
    wait: async (ms, since) => {
      if (closed || (since !== undefined && since !== notifies)) {
        return !closed;
      }
      return await waitFor(timers, waiters, ms);
    },
    close: () => {
      closed = true;
      settleAll(false);
    },
  };
}

async function waitFor(
  timers: QueueTimers,
  waiters: Set<(woken: boolean) => void>,
  ms: number,
): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = timers.setTimeout(() => {
    waiters.delete(settle);
    resolve(false);
  }, ms);
  const settle = (woken: boolean): void => {
    timers.clearTimeout(timer);
    resolve(woken);
  };
  waiters.add(settle);
  return await promise;
}
