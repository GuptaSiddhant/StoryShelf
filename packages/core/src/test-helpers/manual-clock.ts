/**
 * A manual clock with its own timers, for lease, poll-cadence and cancel tests that must not sleep.
 * `advance` moves time forward and fires every timer that falls due, in order, letting promise
 * chains settle between timers, so code under test behaves as it would with real time.
 */

/** A scheduled callback. */
interface PendingTimer {
  id: number;
  at: number;
  callback: () => void;
}

/** Manual clock: `now` for injected clocks, `timers` for injected `setTimeout`/`clearTimeout`. */
export interface ManualClock {
  now: () => number;
  timers: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  /** Move time forward by `ms`, firing due timers in order. */
  advance(ms: number): Promise<void>;
  /** Let pending promise chains run without moving time. */
  flush(): Promise<void>;
  /** Timers currently scheduled. */
  readonly pending: number;
}

/** Let queued promise jobs and I/O callbacks run (a few macrotask turns). */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each turn drains one round of callbacks
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Create a manual clock starting at `start` (epoch ms). */
export function createManualClock(start = Date.parse("2026-01-01T00:00:00.000Z")): ManualClock {
  let current = start;
  let nextId = 1;
  const timers: PendingTimer[] = [];
  const due = (until: number): PendingTimer | undefined =>
    timers.filter((timer) => timer.at <= until).toSorted((a, b) => a.at - b.at || a.id - b.id)[0];
  return {
    now: () => current,
    timers: {
      setTimeout: (callback, ms) => {
        const timer = { id: nextId, at: current + Math.max(0, ms), callback };
        nextId += 1;
        timers.push(timer);
        return timer.id;
      },
      clearTimeout: (handle) => {
        const index = timers.findIndex((timer) => timer.id === handle);
        if (index !== -1) {
          timers.splice(index, 1);
        }
      },
    },
    advance: async (ms) => {
      const until = current + ms;
      await settle();
      for (let timer = due(until); timer !== undefined; timer = due(until)) {
        timers.splice(timers.indexOf(timer), 1);
        current = Math.max(current, timer.at);
        timer.callback();
        // oxlint-disable-next-line eslint/no-await-in-loop -- let the callback's promises settle
        await settle();
      }
      current = until;
      await settle();
    },
    flush: settle,
    get pending() {
      return timers.length;
    },
  };
}
