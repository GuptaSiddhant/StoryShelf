/**
 * The `notify` job kind (ADR 0014, decision 7; ADR 0006, decision 4): one job per `(channel,
 * build)` state change. The job names a channel and a build, never a status: the handler reads the
 * build when it runs, so a retried or reordered job cannot post a stale state. The database keeps
 * at most one non-terminal job per pair (`activeKey`), so a queued job covers a newer request and a
 * request during a delivery earns one more pass.
 */
import type { Logger } from "../../logger.ts";
import { NotificationChannelModel } from "../../models/notification-channel.ts";
import { sanitizeErrorText } from "../../utils/redact.ts";
import { isFinalAttempt } from "../consumer/retry.ts";
import type { ConsumerJob, KindHandler } from "../consumer/types.ts";
import type { QueueJobInput } from "../db-queue/types.ts";
import { deliverBuildState } from "./deliver.ts";
import type { BuildStateDeps } from "./types.ts";

/** Attempts a delivery gets before it is given up (the first try and four retries). */
export const NOTIFY_MAX_ATTEMPTS = 5;

/** Retry delay of a delivery: 10 s, then doubling to at most five minutes. */
export const NOTIFY_BACKOFF = { baseMs: 10_000, maxMs: 5 * 60_000 } as const;

/** Longest error text kept on a channel row. */
const MAX_ERROR_LENGTH = 500;

/** A delivery that was given up: the channel shows the error and the admin event fires. */
export interface NotifyFailure {
  channelId: string;
  projectId: string | null;
  provider: string;
  buildId: string;
  /** Sanitized error text. */
  error: string;
}

/** What {@link createNotifyHandler} needs. */
export interface NotifyHandlerOptions {
  deps: BuildStateDeps;
  /** Called once when a delivery is given up, after the channel row recorded the error. Failures are logged. */
  onFailed?: (failure: NotifyFailure) => Promise<void>;
}

/** The channel a `notify` job delivers to. */
function channelIdOf(job: Pick<ConsumerJob, "data">): string {
  const id = job.data?.["channelId"];
  return typeof id === "string" ? id : "";
}

/**
 * The handler. Resolving acks the job (also when the build or channel is gone: nothing is left to
 * show). A refused status rejects, so the consumer requeues with {@link NOTIFY_BACKOFF}; the last
 * attempt records the error on the channel and raises `onFailed`.
 */
export function createNotifyHandler(options: NotifyHandlerOptions): KindHandler {
  // Jobs told to stop (a cancel or a lost lease). A request already on the wire finishes (the HTTP
  // helper bounds it); what stops is everything after it: no outcome recorded, no failure surfaced.
  const stopped = new Set<string>();
  return {
    accepts: (job) => job.buildId.length > 0 && channelIdOf(job).length > 0,
    backoff: NOTIFY_BACKOFF,
    run: async (job, context) => {
      stopped.delete(keyOf(job));
      try {
        await deliverOnce(options, job, { logger: context.logger, cancelled: stopped });
      } finally {
        stopped.delete(keyOf(job));
      }
    },
    // oxlint-disable-next-line eslint/require-await -- the interface is async; marking is synchronous
    cancel: async (job) => {
      stopped.add(keyOf(job));
    },
  };
}

/** The key a job is tracked under while it runs: its row, else its channel and build. */
function keyOf(job: ConsumerJob): string {
  return job.jobId ?? `${job.buildId}:${channelIdOf(job)}`;
}

/** One delivery attempt; a cancel (checked after the request) suppresses its outcome and failure. */
async function deliverOnce(
  options: NotifyHandlerOptions,
  job: ConsumerJob,
  run: { logger: Logger; cancelled: ReadonlySet<string> },
): Promise<void> {
  const channelId = channelIdOf(job);
  try {
    const result = await deliverBuildState(options.deps, { buildId: job.buildId, channelId });
    if (run.cancelled.has(keyOf(job))) {
      run.logger.info("notify job was cancelled; outcome not recorded");
      return;
    }
    await recordResult(options, { channelId, result, logger: run.logger });
  } catch (error) {
    await failDelivery(options, job, { run, error });
  }
}

/** A failed attempt: silent after a cancel, surfaced on the last attempt, else retried. */
async function failDelivery(
  options: NotifyHandlerOptions,
  job: ConsumerJob,
  what: { run: { logger: Logger; cancelled: ReadonlySet<string> }; error: unknown },
): Promise<void> {
  if (what.run.cancelled.has(keyOf(job))) {
    what.run.logger.info("notify job was cancelled; its failure is not surfaced");
    return;
  }
  if (isFinalAttempt(job)) {
    await surfaceFailure(options, {
      channelId: channelIdOf(job),
      buildId: job.buildId,
      error: what.error,
    });
  }
  throw what.error;
}

/** A delivered state clears the channel's error; anything else is only logged. */
async function recordResult(
  options: NotifyHandlerOptions,
  what: { channelId: string; result: string; logger: Logger },
): Promise<void> {
  if (what.result === "delivered") {
    await channelModel(options.deps).recordOutcome(what.channelId);
  } else {
    what.logger.info({ result: what.result }, "nothing to deliver");
  }
}

/**
 * For the queue's `onExhausted` hook: a last attempt that lost its lease never ran its handler to
 * the end, so the failure is surfaced here (the hook may run on several instances; recording the
 * same error twice is harmless, the admin event may repeat).
 */
export function notifyExhausted(
  options: NotifyHandlerOptions,
): (job: ConsumerJob, error: string) => Promise<void> {
  return async (job, error) => {
    await surfaceFailure(options, { channelId: channelIdOf(job), buildId: job.buildId, error });
  };
}

async function surfaceFailure(
  options: NotifyHandlerOptions,
  failure: { channelId: string; buildId: string; error: unknown },
): Promise<void> {
  const { deps } = options;
  const text = sanitizeErrorText(errorText(failure.error), MAX_ERROR_LENGTH);
  deps.logger.error(
    { channelId: failure.channelId, buildId: failure.buildId, error: text },
    "state delivery given up",
  );
  try {
    await recordAndAlert(options, { ...failure, error: text });
  } catch (error) {
    deps.logger.warn({ err: error, channelId: failure.channelId }, "failed to record the failure");
  }
}

/** Put the error on the channel row, then raise `onFailed`; a channel that is gone needs neither. */
async function recordAndAlert(
  options: NotifyHandlerOptions,
  failure: { channelId: string; buildId: string; error: string },
): Promise<void> {
  const model = channelModel(options.deps);
  const row = await model.get(failure.channelId);
  if (row === null) {
    return;
  }
  await model.recordOutcome(row.id, failure.error);
  await options.onFailed?.({
    channelId: row.id,
    projectId: row.projectId,
    provider: row.provider,
    buildId: failure.buildId,
    error: failure.error,
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function channelModel(deps: BuildStateDeps): NotificationChannelModel {
  return new NotificationChannelModel(
    deps.db,
    { notificationChannels: deps.db.tables.notificationChannels },
    deps.secret,
  );
}

/** The slice of the database queue the enqueuer uses. */
export interface NotifyJobQueue {
  enqueueJob(job: QueueJobInput): Promise<string>;
}

/** The single-flight key of a delivery: one active `notify` job per channel and build. */
export function notifyActiveKey(channelId: string, buildId: string): string {
  return `notify:${channelId}:${buildId}`;
}

/**
 * Enqueue a `notify` job for a channel and build. The database keeps at most one non-terminal job
 * per `(channel, build)` (`activeKey`), so concurrent requests cannot both insert: a request while
 * a job is queued is covered by it (it reads the build's state when it runs), and one while a job
 * is running marks it, so a state change during delivery always gets another pass once it ends.
 */
export function createNotifyEnqueuer(
  // Kept for the callers' signature: the coalescing no longer reads the table from here.
  _deps: Pick<BuildStateDeps, "db">,
  queue: NotifyJobQueue,
): (job: { channelId: string; buildId: string }) => Promise<void> {
  return async ({ channelId, buildId }) => {
    await queue.enqueueJob({
      kind: "notify",
      buildId,
      data: { channelId },
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      activeKey: notifyActiveKey(channelId, buildId),
    });
  };
}
