/**
 * The `notify` job kind (ADR 0014, decision 7; ADR 0006, decision 4): one job per `(channel,
 * build)` state change. The job names a channel and a build, never a status: the handler reads the
 * build when it runs, so a retried or reordered job cannot post a stale state, and a queued job
 * for the same pair already covers a newer request.
 */
import { CaptureJobModel } from "../../models/capture-job.ts";
import { NotificationChannelModel } from "../../models/notification-channel.ts";
import { sanitizeErrorText } from "../../utils/redact.ts";
import { isFinalAttempt } from "../consumer/retry.ts";
import type { ConsumerJob, KindHandler } from "../consumer/types.ts";
import { decodePayload } from "../db-queue/codec.ts";
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
  const { deps } = options;
  return {
    accepts: (job) => job.buildId.length > 0 && channelIdOf(job).length > 0,
    backoff: NOTIFY_BACKOFF,
    run: async (job, context) => {
      const channelId = channelIdOf(job);
      try {
        const result = await deliverBuildState(deps, { buildId: job.buildId, channelId });
        if (result === "delivered") {
          await channelModel(deps).recordOutcome(channelId);
        } else {
          context.logger.info({ result }, "nothing to deliver");
        }
      } catch (error) {
        if (isFinalAttempt(job)) {
          await surfaceFailure(options, { channelId, buildId: job.buildId, error });
        }
        throw error;
      }
    },
  };
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

/**
 * Enqueue a `notify` job for a channel and build, unless one is already waiting: it will read the
 * build's state when it runs, so a second would deliver the same thing. A job that is already
 * running may have read an older state, so a new one is queued behind it.
 */
export function createNotifyEnqueuer(
  deps: Pick<BuildStateDeps, "db">,
  queue: NotifyJobQueue,
): (job: { channelId: string; buildId: string }) => Promise<void> {
  return async ({ channelId, buildId }) => {
    // Built per call: a host that never enqueues must not touch `capture_jobs`.
    const rows = await new CaptureJobModel(deps.db).listForBuild(buildId);
    const waiting = rows.some(
      (row) =>
        row.kind === "notify" &&
        row.status === "queued" &&
        decodePayload(row.payload).data?.["channelId"] === channelId,
    );
    if (!waiting) {
      await queue.enqueueJob({
        kind: "notify",
        buildId,
        data: { channelId },
        maxAttempts: NOTIFY_MAX_ATTEMPTS,
      });
    }
  };
}
