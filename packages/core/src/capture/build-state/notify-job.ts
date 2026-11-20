/**
 * The `notify` job kind (ADR 0014, decision 7; ADR 0006, decision 4): one job per `(channel,
 * build)` or `(repository link, build)` state change. A link's job (`{ linkId }`, ADR 0054) is
 * written at payload version 2, so a release that knows no links hands it back unrun (ADR 0053,
 * decision 5) instead of failing it. The job names a channel and a build, never a status: the handler reads the
 * build when it runs, so a retried or reordered job cannot post a stale state. The database keeps
 * at most one non-terminal job per pair (`activeKey`), so a queued job covers a newer request and a
 * request during a delivery earns one more pass.
 */
import type { Logger } from "../../logger.ts";
import { GitRepositoryLinkModel } from "../../models/git-repository-link.ts";
import { NotificationChannelModel } from "../../models/notification-channel.ts";
import { sanitizeErrorText } from "../../utils/redact.ts";
import { isFinalAttempt } from "../consumer/retry.ts";
import type { ConsumerJob, KindHandler } from "../consumer/types.ts";
import type { QueueJobInput } from "../db-queue/types.ts";
import { deliverBuildState } from "./deliver.ts";
import type { BuildStateDeps, TargetRef } from "./types.ts";

/** Attempts a delivery gets before it is given up (the first try and four retries). */
export const NOTIFY_MAX_ATTEMPTS = 5;

/** Retry delay of a delivery: 10 s, then doubling to at most five minutes. */
export const NOTIFY_BACKOFF = { baseMs: 10_000, maxMs: 5 * 60_000 } as const;

/** Payload version of a link's `notify` job; a channel's stays at 1, which every release reads. */
export const NOTIFY_LINK_PAYLOAD_VERSION = 2;

/** What a request asks a `notify` job to deliver. */
export type NotifyRequest = TargetRef & { buildId: string };

/** Longest error text kept on a channel row. */
const MAX_ERROR_LENGTH = 500;

/**
 * A delivery that was given up: the channel shows the error and the admin event fires. For a
 * repository link, `channelId` is the link's id and `linkId` is set.
 */
export interface NotifyFailure {
  channelId: string;
  linkId?: string;
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

/** The repository link a `notify` job delivers to. */
function linkIdOf(job: Pick<ConsumerJob, "data">): string {
  const id = job.data?.["linkId"];
  return typeof id === "string" ? id : "";
}

/** The job's target: its channel, else its link; null for a job that names neither. */
function targetOf(job: Pick<ConsumerJob, "data">): TargetRef | null {
  const channelId = channelIdOf(job);
  if (channelId.length > 0) return { channelId };
  const linkId = linkIdOf(job);
  return linkId.length > 0 ? { linkId } : null;
}

/** The id a job's target goes by in logs and keys. */
function targetIdOf(job: Pick<ConsumerJob, "data">): string {
  const target = targetOf(job);
  if (target === null) return "";
  return "channelId" in target ? target.channelId : target.linkId;
}

/**
 * The handler. Resolving acks the job (also when the build or channel is gone: nothing is left to
 * show). A refused status rejects, so the consumer requeues with {@link NOTIFY_BACKOFF}; the last
 * attempt records the error on the channel and raises `onFailed`.
 */
export function createNotifyHandler(options: NotifyHandlerOptions): KindHandler {
  // One controller per running attempt: a cancel aborts it, which stops the delivery like a deadline.
  const running = new Map<string, AbortController>();
  return {
    accepts: (job) => job.buildId.length > 0 && targetOf(job) !== null,
    backoff: NOTIFY_BACKOFF,
    payloadVersion: NOTIFY_LINK_PAYLOAD_VERSION,
    run: async (job, context) => {
      const controller = new AbortController();
      running.set(keyOf(job), controller);
      try {
        const signal = AbortSignal.any([context.signal, controller.signal]);
        await runAttempt(options, job, { logger: context.logger, signal });
      } finally {
        // Only this run's own controller: a reclaimed attempt may have registered a newer one.
        if (running.get(keyOf(job)) === controller) running.delete(keyOf(job));
      }
    },
    // oxlint-disable-next-line eslint/require-await -- the interface is async; aborting is synchronous
    cancel: async (job) => {
      running.get(keyOf(job))?.abort(new Error("notify cancelled"));
    },
  };
}

/** One attempt; past its deadline or cancelled it records nothing and surfaces no failure. */
async function runAttempt(
  options: NotifyHandlerOptions,
  job: ConsumerJob,
  context: { logger: Logger; signal: AbortSignal },
): Promise<void> {
  const target = targetOf(job) ?? { channelId: "" };
  try {
    context.signal.throwIfAborted();
    await deliver(options.deps, { job, target }, context);
  } catch (error) {
    if (!context.signal.aborted && isFinalAttempt(job)) {
      await surfaceFailure(options, { target, buildId: job.buildId, error }, context.signal);
    }
    throw error;
  }
}

/** The key a job is tracked under while it runs: its row (else its channel and build) and its attempt. */
function keyOf(job: ConsumerJob): string {
  return `${job.jobId ?? `${job.buildId}:${targetIdOf(job)}`}#${job.attempt ?? 1}`;
}

/** One delivery; the signal is checked before the host is told and before the outcome is recorded. */
async function deliver(
  deps: BuildStateDeps,
  what: { job: ConsumerJob; target: TargetRef },
  context: { logger: Logger; signal: AbortSignal },
): Promise<void> {
  const { job, target } = what;
  const result = await deliverBuildState(deps, { buildId: job.buildId, ...target }, context.signal);
  context.signal.throwIfAborted();
  if (result === "delivered") {
    // A link has no delivery-error column: its state (and `reason` when broken) is what it shows.
    if ("channelId" in target) {
      await channelModel(deps).recordOutcome(target.channelId, undefined, context.signal);
    }
  } else {
    context.logger.info({ result }, "nothing to deliver");
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
    const target = targetOf(job) ?? { channelId: "" };
    await surfaceFailure(options, { target, buildId: job.buildId, error });
  };
}

async function surfaceFailure(
  options: NotifyHandlerOptions,
  failure: { target: TargetRef; buildId: string; error: unknown },
  signal?: AbortSignal,
): Promise<void> {
  const { deps } = options;
  const text = sanitizeErrorText(errorText(failure.error), MAX_ERROR_LENGTH);
  const { target, buildId } = failure;
  deps.logger.error({ ...target, buildId, error: text }, "state delivery given up");
  try {
    await ("channelId" in target
      ? recordAndAlert(options, { channelId: target.channelId, buildId, error: text }, signal)
      : alertLink(options, { linkId: target.linkId, buildId, error: text }, signal));
  } catch (error) {
    deps.logger.warn({ err: error, ...target }, "failed to record the failure");
  }
}

/** Raise `onFailed` for a link given up on; a link that is gone needs nothing. */
async function alertLink(
  options: NotifyHandlerOptions,
  failure: { linkId: string; buildId: string; error: string },
  signal?: AbortSignal,
): Promise<void> {
  const link = await new GitRepositoryLinkModel(options.deps.db).get(failure.linkId);
  signal?.throwIfAborted();
  if (link === null) {
    return;
  }
  const connection = await options.deps.gitConnections?.get(link.connectionId);
  await options.onFailed?.({
    channelId: link.id,
    linkId: link.id,
    projectId: link.projectId,
    provider: connection?.provider === "gitlab-token" ? "gitlab" : "github",
    buildId: failure.buildId,
    error: failure.error,
  });
}

/** Put the error on the channel row, then raise `onFailed`; a channel that is gone needs neither. */
async function recordAndAlert(
  options: NotifyHandlerOptions,
  failure: { channelId: string; buildId: string; error: string },
  signal?: AbortSignal,
): Promise<void> {
  const model = channelModel(options.deps);
  const row = await model.get(failure.channelId);
  signal?.throwIfAborted();
  if (row === null) {
    return;
  }
  await model.recordOutcome(row.id, failure.error, signal);
  signal?.throwIfAborted();
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

/** The single-flight key of a delivery: one active `notify` job per channel (or link) and build. */
export function notifyActiveKey(channelId: string, buildId: string): string {
  return `notify:${channelId}:${buildId}`;
}

/** The single-flight key of a link's delivery; links and channels never share a key. */
export function notifyLinkActiveKey(linkId: string, buildId: string): string {
  return `notify:link:${linkId}:${buildId}`;
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
): (job: NotifyRequest) => Promise<void> {
  return async (request) => {
    const { buildId } = request;
    await queue.enqueueJob(
      "linkId" in request
        ? {
            kind: "notify",
            buildId,
            data: { linkId: request.linkId },
            maxAttempts: NOTIFY_MAX_ATTEMPTS,
            activeKey: notifyLinkActiveKey(request.linkId, buildId),
            payloadVersion: NOTIFY_LINK_PAYLOAD_VERSION,
          }
        : {
            kind: "notify",
            buildId,
            data: { channelId: request.channelId },
            maxAttempts: NOTIFY_MAX_ATTEMPTS,
            activeKey: notifyActiveKey(request.channelId, buildId),
          },
    );
  };
}
