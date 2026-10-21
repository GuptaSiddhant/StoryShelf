/**
 * The holder's side of a lease: renewals follow progress (throttled), never a timer, so a hung run
 * loses its lease; a separate timer only reads the job's state every 5 s, so cancel and takeover
 * are seen within that interval even while the run is hung.
 */
import type {
  LeaseRenewal,
  PollableCaptureQueue,
  PollableJob,
} from "../../adapters/capture-queue.ts";
import type { Logger } from "../../logger.ts";
import { CANCEL_CHECK_MS } from "./cadence.ts";
import { REAL_TIMERS, repeatEvery, type QueueTimers } from "./timers.ts";

/** Longest gap between two renewals while progress keeps coming. */
export const RENEW_THROTTLE_MS = 30_000;

/** Why a held job must stop. */
export type LeaseEnd = Exclude<LeaseRenewal, "ok">;

/** Options of {@link keepJobLease}. */
export interface LeaseKeeperOptions {
  /** Renew at most this often (default `min(RENEW_THROTTLE_MS, leaseMs / 3)`). */
  renewEveryMs?: number;
  /** State check interval (default {@link CANCEL_CHECK_MS}). */
  checkMs?: number;
  /** Clock in epoch ms (default `Date.now`). */
  now?: () => number;
  /** Timers of the state check (default the global timers). */
  timers?: QueueTimers;
  logger?: Logger;
}

/** Handle on a held job's lease. */
export interface JobLeaseKeeper {
  /** Report progress: renews the lease when the throttle allows. */
  touch(): void;
  /** Resolves once, when the job was cancelled or the lease lost; never while the job is ours. */
  readonly ended: Promise<LeaseEnd>;
  /** Stop checking; idempotent. */
  stop(): void;
}

interface KeeperState {
  lastRenewAt: number;
  renewing: boolean;
  warned: boolean;
  stopped: boolean;
  settle: (end: LeaseEnd) => void;
}

/** Keep `job`'s lease on `queue` while the caller reports progress through `touch`. */
export function keepJobLease(
  queue: Pick<PollableCaptureQueue, "extend" | "inspect">,
  job: PollableJob,
  options: LeaseKeeperOptions = {},
): JobLeaseKeeper {
  const now = options.now ?? Date.now;
  const { promise, resolve } = Promise.withResolvers<LeaseEnd>();
  const state: KeeperState = {
    lastRenewAt: now(),
    renewing: false,
    warned: false,
    stopped: false,
    settle: (end) => {
      state.stopped = true;
      resolve(end);
    },
  };
  const stopChecks = startChecks(queue, job, state, options);
  const stop = (): void => {
    state.stopped = true;
    stopChecks();
  };
  promise.then(stop, stop);
  return {
    touch: () => {
      renewIfDue(queue, job, state, { ...options, now });
    },
    ended: promise,
    stop,
  };
}

function startChecks(
  queue: Pick<PollableCaptureQueue, "inspect">,
  job: PollableJob,
  state: KeeperState,
  options: LeaseKeeperOptions,
): () => void {
  const { inspect } = queue;
  if (inspect === undefined) {
    return () => {};
  }
  return repeatEvery(options.timers ?? REAL_TIMERS, options.checkMs ?? CANCEL_CHECK_MS, () => {
    if (!state.stopped) {
      report(state, inspect(job), options.logger, job).catch(() => {});
    }
  });
}

function renewIfDue(
  queue: Pick<PollableCaptureQueue, "extend">,
  job: PollableJob,
  state: KeeperState,
  options: LeaseKeeperOptions & { now: () => number },
): void {
  const { extend } = queue;
  const at = options.now();
  if (
    extend === undefined ||
    state.stopped ||
    state.renewing ||
    at - state.lastRenewAt < renewInterval(job, options)
  ) {
    return;
  }
  state.renewing = true;
  state.lastRenewAt = at;
  report(state, extend(job), options.logger, job)
    .finally(() => {
      state.renewing = false;
    })
    .catch(() => {});
}

/** Settle on a non-ok outcome; a failed call is transient (warned once, the next one retries). */
async function report(
  state: KeeperState,
  outcome: Promise<LeaseRenewal>,
  logger: Logger | undefined,
  job: PollableJob,
): Promise<void> {
  try {
    const result = await outcome;
    if (result !== "ok" && !state.stopped) {
      state.settle(result);
    }
  } catch (error) {
    if (!state.warned) {
      state.warned = true;
      logger?.warn({ err: error, buildId: job.buildId }, "failed to renew or check queue lease");
    }
  }
}

function renewInterval(job: PollableJob, options: LeaseKeeperOptions): number {
  if (options.renewEveryMs !== undefined) {
    return options.renewEveryMs;
  }
  const third = job.leaseMs === undefined ? RENEW_THROTTLE_MS : Math.floor(job.leaseMs / 3);
  return Math.max(1, Math.min(RENEW_THROTTLE_MS, third));
}
