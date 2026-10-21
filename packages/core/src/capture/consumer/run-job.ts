/**
 * Run one claimed job to its end: pick the handler by kind, keep the lease by progress, then settle
 * the job on the queue (ack, retry with backoff, fail, or leave it to whoever owns it now).
 */
import type { PollableCaptureQueue } from "../../adapters/capture-queue.ts";
import type { Logger } from "../../logger.ts";
import { roundedTimings, runWithTimings } from "../../utils/timing.ts";
import { keepJobLease, type JobLeaseKeeper, type LeaseEnd } from "../db-queue/keeper.ts";
import type { QueueTimers } from "../db-queue/timers.ts";
import { reportFinished, type ConsumerMetrics, type JobOutcome } from "./metrics.ts";
import { backoffDelayMs, DEFAULT_BACKOFF_MS, isFinalAttempt } from "./retry.ts";
import type { ConsumerJob, KindHandler } from "./types.ts";

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

/** Fail a job nobody can run (no handler for its kind) or that is malformed; null when runnable. */
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
  if (handler.accepts?.(job) === false) {
    logger.warn({ attempts: job.attempts }, "dropping malformed queue job");
    await failJob(rt, job, "malformed job", logger);
    return "dropped";
  }
  return null;
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
  const run = invoke(handler, job, { logger, touch });
  try {
    const raced = await Promise.race([run, endOf(keeper)]);
    return raced.kind === "ended"
      ? await abandon(rt, held, raced.end)
      : await settle(rt, held, raced);
  } finally {
    keeper.stop();
    run.catch(() => {});
  }
}

function keepLease(rt: JobRuntime, job: ConsumerJob, logger: Logger): JobLeaseKeeper {
  return keepJobLease(rt.queue, job, {
    ...rt.lease,
    now: rt.now,
    ...(rt.timers === undefined ? {} : { timers: rt.timers }),
    logger,
  });
}

/** Run the handler, timing it; its failure is a value so the race can carry it. */
async function invoke(
  handler: KindHandler,
  job: ConsumerJob,
  context: { logger: Logger; touch: () => void },
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
  held: { job: ConsumerJob; logger: Logger },
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
  held: { job: ConsumerJob; logger: Logger },
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
  held: { job: ConsumerJob; logger: Logger },
  failure: { error: unknown; message: string; attempts: number },
): Promise<void> {
  const delayMs = backoffDelayMs(failure.attempts, rt.backoffMs ?? DEFAULT_BACKOFF_MS);
  await rt.queue.nack(held.job, { requeue: true, delayMs, error: failure.message });
  held.logger.warn(
    { err: failure.error, attempts: failure.attempts, delayMs },
    "job failed, requeued",
  );
}

/**
 * The lease is gone or the job was cancelled while the handler ran: stop the work. A lost lease
 * means another consumer owns the job (it settles it); a cancel is settled here as `cancelled`.
 */
async function abandon(
  rt: JobRuntime,
  held: { job: ConsumerJob; handler: KindHandler; logger: Logger },
  end: LeaseEnd,
): Promise<JobOutcome> {
  const { job, handler, logger } = held;
  await handler.cancel?.(job).catch((error: unknown) => {
    logger.warn({ err: error }, "failed to cancel the running job");
  });
  if (end === "lost") {
    logger.warn("queue lease lost, aborting job");
    return "lost";
  }
  logger.info("job cancelled, aborting");
  await rt.queue.nack(job, { requeue: false, error: "cancelled" });
  return "cancelled";
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
