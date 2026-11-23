/**
 * The slot-aware poll loop over the database queue: an instance polls only while it has a free
 * slot, at the cadence of `cadence.ts`, and dispatches at once on a local enqueue. Each claimed job
 * runs in a slot; the caller's `run` owns ack/nack and the lease. The full consumer (retries, the
 * final-attempt rule, drain on SIGTERM) builds on this loop.
 */
import type { Logger } from "../../logger.ts";
import { DEFAULT_CADENCE, nextPollDelay, type PollCadence } from "./cadence.ts";
import type { DatabaseCaptureQueue, DatabaseJob } from "./types.ts";

/** Options of {@link startPollLoop}. */
export interface PollLoopOptions {
  queue: Pick<DatabaseCaptureQueue, "poll" | "waitForWork">;
  /** Jobs this instance runs at once (`testing.concurrency`). */
  slots: number;
  /** Run one claimed job to its end (ack or nack it); rejections are logged, never fatal. */
  run: (job: DatabaseJob) => Promise<void>;
  cadence?: PollCadence;
  now?: () => number;
  random?: () => number;
  logger?: Logger;
}

/** Handle on a running poll loop. */
export interface PollLoop {
  /** Jobs running right now. */
  readonly busy: number;
  /** Stop polling and wait for the jobs in flight to finish; idempotent. */
  stop(): Promise<void>;
}

interface LoopState {
  busy: number;
  stopped: boolean;
  lastWorkAt: number | null;
  inFlight: Set<Promise<void>>;
  /** Resolves the current idle wait early (slot freed or stop). */
  nudge: () => void;
}

/** Start polling `queue` with `slots` concurrent jobs. */
export function startPollLoop(options: PollLoopOptions): PollLoop {
  const state: LoopState = {
    busy: 0,
    stopped: false,
    lastWorkAt: null,
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

async function loop(options: PollLoopOptions, state: LoopState): Promise<void> {
  const now = options.now ?? Date.now;
  while (!state.stopped) {
    // oxlint-disable-next-line no-await-in-loop -- one step at a time is the loop
    await step(options, state, now);
  }
}

/** One turn: wait for a slot (no poll while all are busy), else probe once and run or idle. */
async function step(options: PollLoopOptions, state: LoopState, now: () => number): Promise<void> {
  if (state.busy >= options.slots) {
    await nudged(state);
    return;
  }
  const job = await pollOnce(options);
  if (job === null) {
    await idle(options, state, now);
    return;
  }
  state.lastWorkAt = now();
  launch(options, state, job);
}

async function pollOnce(options: PollLoopOptions): Promise<DatabaseJob | null> {
  try {
    return await options.queue.poll();
  } catch (error) {
    options.logger?.warn({ err: error }, "queue poll failed");
    return null;
  }
}

async function idle(options: PollLoopOptions, state: LoopState, now: () => number): Promise<void> {
  const delay = nextPollDelay(
    state.lastWorkAt,
    now(),
    options.cadence ?? DEFAULT_CADENCE,
    options.random,
  );
  const woken = await Promise.race([
    options.queue.waitForWork(delay),
    nudged(state).then(() => false),
  ]);
  if (woken) {
    state.lastWorkAt = now();
  }
}

function launch(options: PollLoopOptions, state: LoopState, job: DatabaseJob): void {
  state.busy += 1;
  const running = runSafely(options, job).finally(() => {
    state.busy -= 1;
    state.inFlight.delete(running);
    state.nudge();
  });
  state.inFlight.add(running);
}

async function runSafely(options: PollLoopOptions, job: DatabaseJob): Promise<void> {
  try {
    await options.run(job);
  } catch (error) {
    options.logger?.error({ err: error, jobId: job.jobId }, "queue job run failed");
  }
}

/** A promise the next nudge (slot freed, stop) resolves. */
async function nudged(state: LoopState): Promise<void> {
  if (state.stopped) {
    return;
  }
  const { promise, resolve } = Promise.withResolvers<null>();
  state.nudge = (): void => {
    resolve(null);
  };
  await promise;
}
