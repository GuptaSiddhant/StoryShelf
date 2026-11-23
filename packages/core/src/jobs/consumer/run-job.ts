/**
 * Run one claimed job to its end: pick the handler by kind, keep the lease (heartbeat and progress), then settle
 * the job on the queue (ack, retry with backoff, fail, hand it back on shutdown, or leave it to whoever owns it now).
 */
import type { PollableCaptureQueue } from "../../adapters/capture-queue.ts";
import type { Logger } from "../../logger.ts";
import { roundedTimings, runWithTimings } from "../../utils/timing.ts";
import { keepJobLease, type JobLeaseKeeper, type LeaseEnd } from "../db-queue/keeper.ts";
import { REAL_TIMERS, type QueueTimers } from "../db-queue/timers.ts";
import { reportFinished, type ConsumerMetrics, type JobOutcome } from "./metrics.ts";
import { backoffDelayMs, DEFAULT_BACKOFF_MS, isFinalAttempt } from "./retry.ts";
import type { Releaser } from "./shutdown.ts";
import type { ConsumerJob, JobRunContext, KindHandler } from "./types.ts";

/** What {@link runJob} needs from the consumer. */
export interface JobRuntime {
  queue: PollableCaptureQueue;
  /** Normalized registry. */
  handlers: ReadonlyMap<string, KindHandler>;
  maxRetries: number;
  backoffMs?: number;
  logger: Logger;
  metrics?: ConsumerMetrics | undefined;
  onProgress?: ((job: ConsumerJob) => void) | undefined;
  now: () => number;
  timers?: QueueTimers | undefined;
  lease?: { renewEveryMs?: number; checkMs?: number } | undefined;
  /** Wall-clock bound of one job in ms; absent means unbounded (tests). */
  maxJobMs?: number | undefined;
  /** The session's releaser: a draining stop whose grace ran out releases the running jobs (#912). */
  releaser?: Releaser | undefined;
}

/** Why a job's handler stopped: it finished (or threw), or the queue took the job away. */
type Race = { kind: "settled"; error?: unknown } | { kind: "ended"; end: LeaseEnd };

/** Run `job` in the slot the caller holds; never rejects. */
export async function runJob(rt: JobRuntime, job: ConsumerJob): Promise<void> {
  const kind = job.kind ?? "capture";
  const startedAt = rt.now();
  const logger = rt.logger.child({
    buildId: job.buildId,
    jobId: job.jobId ?? job.receipt,
    kind,
    reqId: job.reqId,
  });
  const finish = (outcome: JobOutcome): void => {
    reportFinished(rt.metrics, {
      kind,
      outcome,
      durationMs: rt.now() - startedAt,
      attempt: job.attempt ?? (job.attempts ?? 0) + 1,
    });
  };
  try {
    finish(await execute(rt, job, logger));
  } catch (error) {
    // Settling failed (the database is unreachable): the lease runs out and the queue redelivers.
    logger.error({ err: error }, "failed to settle job");
    finish("failed");
  }
}

async function execute(rt: JobRuntime, job: ConsumerJob, logger: Logger): Promise<JobOutcome> {
  const handler = rt.handlers.get(job.kind ?? "capture");
  const refused = await refuse(rt, job, { handler, logger });
  if (refused !== null || handler === undefined) {
    return refused ?? "unhandled";
  }
  return await runHandler(rt, { job, handler, logger });
}

/**
 * Settle a job this consumer cannot run now: a kind with no handler (a queue that does not filter
 * by kind; the database queue never claims one), a payload newer than the handler reads, or a
 * malformed job. Null when runnable.
 */
async function refuse(
  rt: JobRuntime,
  job: ConsumerJob,
  held: { handler: KindHandler | undefined; logger: Logger },
): Promise<JobOutcome | null> {
  const { handler, logger } = held;
  if (handler === undefined) {
    logger.error("no handler registered for job kind; failing the job");
    await failJob(rt, job, `no handler registered for job kind "${job.kind ?? "capture"}"`, logger);
    return "unhandled";
  }
  return (job.payloadVersion ?? 1) > (handler.payloadVersion ?? 1)
    ? await handBackNewer(rt, job, logger)
    : await refuseUnrunnable(rt, job, { handler, logger });
}

async function refuseUnrunnable(
  rt: JobRuntime,
  job: ConsumerJob,
  held: { handler: KindHandler; logger: Logger },
): Promise<JobOutcome | null> {
  const { handler, logger } = held;
  if (handler.accepts?.(job) === false) {
    logger.warn({ attempts: job.attempts }, "dropping malformed queue job");
    await failJob(rt, job, "malformed job", logger);
    return "dropped";
  }
  return (await handler.superseded?.(job)) === true ? await endSuperseded(rt, job, logger) : null;
}

/** A newer release wrote this payload: give it back unrun, with its attempts unchanged. */
async function handBackNewer(
  rt: JobRuntime,
  job: ConsumerJob,
  logger: Logger,
): Promise<JobOutcome> {
  logger.warn(
    { payloadVersion: job.payloadVersion },
    "payload is newer than this handler; handing the job back",
  );
  await rt.queue.handBack?.(job, { reason: "payload version" });
  return "handed-back";
}

/** The job's run was superseded: cancel it, so it ends `cancelled` with no build write. */
async function endSuperseded(
  rt: JobRuntime,
  job: ConsumerJob,
  logger: Logger,
): Promise<JobOutcome> {
  logger.info("job belongs to a superseded run; cancelling");
  if (job.jobId !== undefined) {
    await rt.queue.cancel?.(job.jobId);
  }
  await rt.queue.nack(job, { requeue: false, error: "superseded" });
  return "cancelled";
}

async function runHandler(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
): Promise<JobOutcome> {
  const { job, handler, logger } = held;
  const keeper = keepLease(rt, job, logger);
  const touch = (): void => {
    keeper.touch();
    rt.onProgress?.(job);
  };
  logger.info("consumer picked up job");
  const run = invoke(handler, job, { logger, touch, signal: keeper.signal });
  try {
    const raced = await Promise.race([run, endOf(keeper)]);
    return raced.kind === "settled"
      ? await settle(rt, held, raced)
      : await abandonAndWait(rt, held, { end: raced.end, run });
  } finally {
    keeper.stop();
    run.catch(() => {});
  }
}

/** Stop an abandoned job, then keep its slot until its handler has returned (bounded). */
async function abandonAndWait(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  stopped: { end: LeaseEnd; run: Promise<Race> },
): Promise<JobOutcome> {
  if (stopped.end === "released") {
    return await handBackReleased(rt, held, stopped.run);
  }
  const outcome = await abandon(rt, held, stopped.end);
  // The slot is this job's until its work has stopped: never count it free while a render runs.
  await awaitStop(rt, stopped.run, held.logger);
  return outcome;
}

/**
 * Longest an abandoned job's handler (cancelled, lease lost, past its deadline) may keep its slot
 * once it was told to stop: its signal is aborted and its runner cancelled, so it ends at its next
 * checkpoint, well within this. One that does not is logged and its slot freed anyway.
 */
export const STOP_GRACE_MS = 30_000;

/** Wait for an abandoned handler to return, at most {@link STOP_GRACE_MS}; log how it ended. */
async function awaitStop(rt: JobRuntime, run: Promise<Race>, logger: Logger): Promise<void> {
  const since = rt.now();
  if (await within(rt, run, STOP_GRACE_MS)) {
    logger.info({ waitedMs: rt.now() - since }, "abandoned job stopped");
    return;
  }
  logger.error(
    { seconds: STOP_GRACE_MS / 1000 },
    "abandoned job still running after its stop grace; freeing its slot",
  );
}

/**
 * The shutdown's grace ran out (#912): the job's signal is aborted; cancel its run and give the
 * handler the releaser's reserve to stop. Only a stopped handler's job is handed back (visible at
 * once, no attempt spent): while the handler may still write, another instance must not claim the
 * job, so one that has not stopped is left to its lease, as before #912. A queue without
 * `handBack` leaves the job to its lease as well.
 */
async function handBackReleased(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  run: Promise<Race>,
): Promise<JobOutcome> {
  if (!(await stopsWithinReserve(rt, held, run))) {
    return "lost";
  }
  if (rt.queue.handBack === undefined) {
    held.logger.warn("queue cannot hand a job back; leaving it to its lease");
    return "lost";
  }
  await rt.queue.handBack(held.job, { delayMs: 0, reason: "shutdown" });
  return "handed-back";
}

/** Cancel a released job's run and wait the releaser's reserve for its handler; logs a stall. */
async function stopsWithinReserve(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  run: Promise<Race>,
): Promise<boolean> {
  const reserveMs = rt.releaser?.reserveMs ?? 0;
  held.logger.warn({ reserveMs }, "shutdown grace over; handing job back");
  // The cancel is not waited for: what decides the hand-back is whether the handler has stopped.
  cancelQuietly(held).catch(() => {});
  if (await within(rt, run, reserveMs)) {
    return true;
  }
  held.logger.error({ reserveMs }, "released job still running; leaving it to its lease");
  return false;
}

/** Cancel the handler's run; a failure is logged, never thrown. */
async function cancelQuietly(held: {
  job: ConsumerJob;
  handler: KindHandler;
  logger: Logger;
}): Promise<void> {
  try {
    await held.handler.cancel?.(held.job);
  } catch (error) {
    held.logger.warn({ err: error }, "failed to cancel the running job");
  }
}

/** Keep the job's lease; the session's releaser can release it until the keeper stops. */
function keepLease(rt: JobRuntime, job: ConsumerJob, logger: Logger): JobLeaseKeeper {
  const keeper = leaseOf(rt, job, logger);
  const untrack = rt.releaser?.register(() => {
    keeper.release();
  });
  return {
    ...keeper,
    stop: () => {
      untrack?.();
      keeper.stop();
    },
  };
}

function leaseOf(rt: JobRuntime, job: ConsumerJob, logger: Logger): JobLeaseKeeper {
  return keepJobLease(rt.queue, job, {
    ...rt.lease,
    ...(rt.maxJobMs === undefined ? {} : { maxJobMs: rt.maxJobMs }),
    now: rt.now,
    ...(rt.timers === undefined ? {} : { timers: rt.timers }),
    logger,
  });
}

/** Run the handler, timing it; its failure is a value so the race can carry it. */
async function invoke(
  handler: KindHandler,
  job: ConsumerJob,
  context: JobRunContext,
): Promise<Race> {
  try {
    const { timings } = await runWithTimings(async () => {
      await handler.run(job, context);
    });
    context.logger.info({ timings: roundedTimings(timings) }, "consumer job timings");
    return { kind: "settled" };
  } catch (error) {
    return { kind: "settled", error };
  }
}

async function endOf(keeper: JobLeaseKeeper): Promise<Race> {
  return { kind: "ended", end: await keeper.ended };
}

/** The handler returned: ack, or retry / fail on its error. */
async function settle(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  raced: Race & { kind: "settled" },
): Promise<JobOutcome> {
  if (!("error" in raced)) {
    await rt.queue.ack(held.job);
    held.logger.info("consumer completed job");
    return "completed";
  }
  return await retryOrFail(rt, held, raced.error);
}

/** The handler threw: requeue with backoff, or fail the job on its last attempt. */
async function retryOrFail(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  error: unknown,
): Promise<JobOutcome> {
  const { job, logger } = held;
  const message = error instanceof Error ? error.message : String(error);
  const attempts = job.attempts ?? 0;
  if (isFinalAttempt(job, rt.maxRetries)) {
    await failJob(rt, job, message, logger);
    logger.error({ err: error, attempts }, "capture permanently failed");
    return "failed";
  }
  await requeue(rt, held, { error, message, attempts });
  return "retried";
}

/** Put the job back with the next backoff delay. */
async function requeue(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  failure: { error: unknown; message: string; attempts: number },
): Promise<void> {
  const { backoff } = held.handler;
  const delayMs = backoffDelayMs(
    failure.attempts,
    backoff?.baseMs ?? rt.backoffMs ?? DEFAULT_BACKOFF_MS,
    backoff?.maxMs,
  );
  await rt.queue.nack(held.job, { requeue: true, delayMs, error: failure.message });
  held.logger.warn(
    { err: failure.error, attempts: failure.attempts, delayMs },
    "job failed, requeued",
  );
}

/**
 * The lease is gone or the job was cancelled while the handler ran: stop the work (its signal is
 * already aborted; the runner is cancelled here). A lost lease means another consumer owns the job
 * (it settles it); a cancel is settled here as `cancelled`. The caller then waits for the handler.
 */
async function abandon(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  end: Exclude<LeaseEnd, "released">,
): Promise<JobOutcome> {
  const { job, handler, logger } = held;
  if (end === "deadline") {
    return await endAtDeadline(rt, held);
  }
  logAbort(logger, end);
  await handler.cancel?.(job).catch((error: unknown) => {
    logger.warn({ err: error }, "failed to cancel the running job");
  });
  if (end === "lost") {
    return "lost";
  }
  await rt.queue.nack(job, { requeue: false, error: "cancelled" });
  return "cancelled";
}

/** The job's logger carries its build id, so this line says which build is being stopped. */
function logAbort(logger: Logger, end: "lost" | "cancelled"): void {
  if (end === "lost") {
    logger.warn("queue lease lost, aborting job");
  } else {
    logger.info("job cancelled, aborting");
  }
}

/**
 * The job passed its wall-clock bound: its work was cancelled above and its lease is no longer
 * renewed, so it runs out and the queue redelivers the job or hands it to its exhausted hook. The
 * job is not nacked here (that would skip the lease it still holds), and it never ends `cancelled`.
 */
async function endAtDeadline(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
): Promise<JobOutcome> {
  const { job, handler, logger } = held;
  const seconds = Math.round((rt.maxJobMs ?? 0) / 1000);
  logger.error({ seconds }, "job deadline exceeded; abandoning it to its lease");
  await boundedCleanup(rt, handler.cancel?.(job), logger, "cancel the job past its deadline");
  await boundedCleanup(rt, handler.deadlineExceeded?.(job, seconds), logger, "record the deadline");
  return "deadline";
}

/** Longest the cleanup of a job past its deadline may hold the slot; the lease recovers the job. */
export const DEADLINE_CLEANUP_MS = 10_000;

/** Wait for `work` at most {@link DEADLINE_CLEANUP_MS}; a failure or a stall is logged, never thrown. */
async function boundedCleanup(
  rt: JobRuntime,
  work: Promise<unknown> | undefined,
  logger: Logger,
  what: string,
): Promise<void> {
  if (work === undefined) {
    return;
  }
  const finished = work.then(
    () => {},
    (error: unknown) => {
      logger.warn({ err: error }, `failed to ${what}`);
    },
  );
  if (!(await within(rt, finished, DEADLINE_CLEANUP_MS))) {
    logger.warn({ what }, "cleanup past the deadline stalled; leaving it to the lease");
  }
}

/** Whether `work` (which never rejects) settles within `ms`. */
async function within(rt: JobRuntime, work: Promise<unknown>, ms: number): Promise<boolean> {
  const timers = rt.timers ?? REAL_TIMERS;
  const stalled = Promise.withResolvers<false>();
  const handle = timers.setTimeout(() => {
    stalled.resolve(false);
  }, ms);
  try {
    return await Promise.race([work.then(() => true), stalled.promise]);
  } finally {
    timers.clearTimeout(handle);
  }
}

/**
 * Final failure: nack without requeue so the queue records it failed. A queue that does not count
 * attempts itself falls back to ack when the nack fails, so a poison job never loops; the database
 * queue (it states `maxAttempts`) ends the job by itself, so there a failed nack is left to it.
 */
async function failJob(
  rt: JobRuntime,
  job: ConsumerJob,
  message: string,
  logger: Logger,
): Promise<void> {
  try {
    await rt.queue.nack(job, { requeue: false, error: message });
  } catch (nackError) {
    if (typeof job.maxAttempts === "number") {
      throw nackError;
    }
    logger.warn({ err: nackError }, "final nack failed, acknowledging the job instead");
    await rt.queue.ack(job);
  }
}
