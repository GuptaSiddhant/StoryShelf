import type { LeaseRenewal, PollableJob } from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";

/** Renews a polled job's queue lease; see `PollableCaptureQueue.extend`. */
export type ExtendLease = (job: PollableJob) => Promise<LeaseRenewal>;

/** Fraction of the lease at which renewal fires (renew at 1/3, leaving two retries). */
const RENEW_FRACTION = 3;

/** Thrown into a capture's slot when the queue reports its lease is gone. */
export class LeaseLostError extends Error {
  constructor(buildId: string) {
    super(`queue lease lost for build ${buildId}`);
    this.name = "LeaseLostError";
  }
}

/** Handle for a running lease heartbeat. */
export interface LeaseHeartbeat {
  /** Rejects with `LeaseLostError` if the lease is conclusively lost. Never resolves otherwise. */
  readonly lost: Promise<never>;
  /** Stop renewing; idempotent. */
  stop(): void;
}

/** Mutable heartbeat state shared between ticks. */
interface LeaseState {
  timer: ReturnType<typeof setTimeout> | undefined;
  stopped: boolean;
  warned: boolean;
}

/** Run one renewal; resolves true to keep renewing, false once the lease is lost. */
async function renewOnce(
  job: PollableJob,
  extend: ExtendLease,
  state: LeaseState,
  logger: Logger | undefined,
): Promise<boolean> {
  try {
    return (await extend(job)) !== "lost";
  } catch (error) {
    if (!state.warned) {
      state.warned = true;
      logger?.warn({ err: error, buildId: job.buildId }, "failed to renew queue lease");
    }
    return true;
  }
}

/** A never-resolving promise plus its rejector; pre-handled so an unobserved loss is not fatal. */
function deferredLoss(): { lost: Promise<never>; reject: (error: Error) => void } {
  const { promise, reject } = Promise.withResolvers<never>();
  promise.catch(() => {});
  return { lost: promise, reject };
}

/**
 * Periodically extend `job`'s lease until stopped. Renewal errors are
 * warned once per job and never fatal; only a `"lost"` result settles `lost`.
 * Returns null when the job or transport has no renewable lease.
 */
export function startLease(
  job: PollableJob,
  extend: ExtendLease | undefined,
  logger?: Logger,
): LeaseHeartbeat | null {
  if (!extend || !job.leaseMs || job.leaseMs <= 0) {
    return null;
  }
  const intervalMs = Math.max(1, Math.floor(job.leaseMs / RENEW_FRACTION));
  const state: LeaseState = { timer: undefined, stopped: false, warned: false };
  const { lost, reject } = deferredLoss();

  const schedule = (): void => {
    if (!state.stopped) {
      state.timer = setTimeout(tick, intervalMs);
    }
  };
  const tick = (): void => {
    renewOnce(job, extend, state, logger).then(
      (keepGoing) => {
        if (keepGoing) {
          schedule();
        } else if (!state.stopped) {
          state.stopped = true;
          reject(new LeaseLostError(job.buildId));
        }
      },
      () => {},
    );
  };
  schedule();
  return {
    lost,
    stop(): void {
      state.stopped = true;
      clearTimeout(state.timer);
    },
  };
}
