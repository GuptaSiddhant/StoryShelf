/**
 * The bounded SIGTERM drain (#912). `stop({ graceMs })` waits for the jobs in flight until
 * {@link releaseAtMs}; each job still running then is released: its keeper aborts its signal, its
 * handler's `cancel` runs, and once the handler stopped (or the reserve ran out) the job is handed
 * back to the queue (`handBack`), visible again at once and without spending an attempt. The
 * reserve keeps the whole stop within `graceMs`, so the host can exit before the platform kills it.
 */
import { REAL_TIMERS, type QueueTimers } from "../db-queue/timers.ts";

/** Longest part of the grace kept for stopping and handing back the jobs still running. */
export const HAND_BACK_RESERVE_MS = 2000;

/** When, after the stop began, the jobs still running are released: the grace minus its reserve. */
export function releaseAtMs(graceMs: number): number {
  return Math.max(0, graceMs - reserveMs(graceMs));
}

/** The reserve of a grace: {@link HAND_BACK_RESERVE_MS}, or a quarter of a short grace. */
export function reserveMs(graceMs: number): number {
  return Math.max(0, Math.min(HAND_BACK_RESERVE_MS, Math.floor(graceMs / 4)));
}

/** The running jobs of one consumer session, released together when the grace runs out. */
export interface Releaser {
  /** Track a running job's release; the returned function untracks it. Released at once if late. */
  register(release: () => void): () => void;
  /**
   * Release every job tracked now and every one registered later; each may take `reserve` ms to
   * stop before it is handed back anyway.
   */
  releaseAll(reserve: number): void;
  /** How long a released job may take to stop before it is handed back anyway (0 until released). */
  readonly reserveMs: number;
}

/** A releaser of one consumer session's running jobs. */
export function createReleaser(): Releaser {
  const running = new Set<() => void>();
  let released = false;
  let reserve = 0;
  return {
    get reserveMs() {
      return reserve;
    },
    register: (release) => {
      if (released) {
        release();
        return () => {};
      }
      running.add(release);
      return () => {
        running.delete(release);
      };
    },
    releaseAll: (ms) => {
      released = true;
      reserve = ms;
      for (const release of running) {
        release();
      }
      running.clear();
    },
  };
}

/**
 * Wait for `draining` (the loop's stop: no more polls, jobs in flight finishing). With a grace,
 * release what still runs at {@link releaseAtMs}, then wait for the hand-backs to settle.
 */
export async function drainWithin(
  draining: Promise<void>,
  bound: { graceMs: number | undefined; releaser: Releaser; timers?: QueueTimers | undefined },
): Promise<void> {
  const { graceMs, releaser } = bound;
  if (graceMs === undefined) {
    await draining;
    return;
  }
  const timers = bound.timers ?? REAL_TIMERS;
  const handle = timers.setTimeout(() => {
    releaser.releaseAll(reserveMs(graceMs));
  }, releaseAtMs(graceMs));
  try {
    await draining;
  } finally {
    timers.clearTimeout(handle);
  }
}
