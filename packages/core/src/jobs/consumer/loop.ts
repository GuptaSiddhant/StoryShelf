/**
 * The slot-aware poll loop for queues that are not the database queue: a slot is taken BEFORE
 * polling (polling first would leave a job idle while every slot is busy, and its lease, a remote
 * queue's visibility or the forked parent's progress lease, would run out), polls block inside the
 * queue where they can, and an empty poll that returns at once backs off instead of spinning.
 */
import type { PollableCaptureQueue } from "../../adapters/capture-queue.ts";
import type { Logger } from "../../logger.ts";
import type { PollLoop } from "../db-queue/poll-loop.ts";
import { REAL_TIMERS, type QueueTimers } from "../db-queue/timers.ts";
import { idleDelayMs, isFastEmptyPoll } from "./idle.ts";
import type { ConsumerJob } from "./types.ts";

/** Pause after a failed poll. */
export const POLL_ERROR_DELAY_MS = 1000;

/** Options of {@link startSlotLoop}. */
export interface SlotLoopOptions {
  queue: PollableCaptureQueue;
  slots: number;
  /** Long-poll wait handed to `poll`. */
  waitMs: number;
  /** Run one claimed job to its end; must not reject. */
  run: (job: ConsumerJob) => Promise<void>;
  logger: Logger;
  now?: () => number;
  timers?: QueueTimers;
}

interface LoopState {
  busy: number;
  stopped: boolean;
  emptyStreak: number;
  inFlight: Set<Promise<void>>;
  /** Resolves the current wait (slot freed, backoff sleep, stop) early. */
  nudge: () => void;
}

/** Start consuming `queue` with `slots` concurrent jobs. */
export function startSlotLoop(options: SlotLoopOptions): PollLoop {
  const state: LoopState = {
    busy: 0,
    stopped: false,
    emptyStreak: 0,
    inFlight: new Set(),
    nudge: () => {},
  };
  const done = loop(options, state);
  return {
    get busy() {
      return state.busy;
    },
    stop: async () => {
      state.stopped = true;
      state.nudge();
      await done;
      await Promise.allSettled(state.inFlight);
    },
  };
}

async function loop(options: SlotLoopOptions, state: LoopState): Promise<void> {
  while (!state.stopped) {
    // oxlint-disable-next-line no-await-in-loop -- one step at a time is the loop
    await step(options, state);
  }
}

async function step(options: SlotLoopOptions, state: LoopState): Promise<void> {
  if (state.busy >= options.slots) {
    await sleep(state, options.timers, null);
    return;
  }
  // The slot is held from here: released again unless a job came back to run in it.
  state.busy += 1;
  const polled = await pollTimed(options, state);
  if (polled.job === null) {
    state.busy -= 1;
    await afterEmpty(options, state, polled.elapsedMs);
  } else {
    state.emptyStreak = 0;
    launch(options, state, polled.job);
  }
}

/** One poll with its duration; `elapsedMs` is null when the poll failed. */
async function pollTimed(
  options: SlotLoopOptions,
  state: LoopState,
): Promise<{ job: ConsumerJob | null; elapsedMs: number | null }> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const job = await pollOnce(options, state);
  return job === undefined ? { job: null, elapsedMs: null } : { job, elapsedMs: now() - startedAt };
}

/** Back off after an empty poll that did not block, or after a failed one (`elapsed` null). */
async function afterEmpty(
  options: SlotLoopOptions,
  state: LoopState,
  elapsedMs: number | null,
): Promise<void> {
  if (elapsedMs === null) {
    await sleep(state, options.timers, POLL_ERROR_DELAY_MS);
    return;
  }
  // Queues without long-poll return instantly; back off instead of spinning.
  state.emptyStreak = isFastEmptyPoll(elapsedMs) ? state.emptyStreak + 1 : 0;
  if (state.emptyStreak > 0) {
    await sleep(state, options.timers, idleDelayMs(state.emptyStreak));
  }
}

/** The next job, null when empty, undefined when the poll failed (logged). */
async function pollOnce(
  options: SlotLoopOptions,
  state: LoopState,
): Promise<ConsumerJob | null | undefined> {
  if (state.stopped) {
    return null;
  }
  try {
    return await options.queue.poll({ waitMs: options.waitMs });
  } catch (error) {
    options.logger.error({ err: error }, "poll failed");
    return undefined;
  }
}

function launch(options: SlotLoopOptions, state: LoopState, job: ConsumerJob): void {
  const running = options
    .run(job)
    .catch((error: unknown) => {
      options.logger.error({ err: error, buildId: job.buildId }, "job run failed");
    })
    .finally(() => {
      state.busy -= 1;
      state.inFlight.delete(running);
      state.nudge();
    });
  state.inFlight.add(running);
}

/** Wait for `ms` (or, without one, for a nudge); a nudge (slot freed, stop) ends it early. */
async function sleep(
  state: LoopState,
  timers: QueueTimers | undefined,
  ms: number | null,
): Promise<void> {
  if (state.stopped) {
    return;
  }
  const { promise, resolve } = Promise.withResolvers<null>();
  const wake = (): void => {
    resolve(null);
  };
  const clock = timers ?? REAL_TIMERS;
  const handle = ms === null ? null : clock.setTimeout(wake, ms);
  state.nudge = wake;
  await promise;
  if (handle !== null) {
    clock.clearTimeout(handle);
  }
}
