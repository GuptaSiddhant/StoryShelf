import type { NotificationChannel } from "@storyshelf/core/adapter/notifier";
/**
 * The `review-request` job kind (ADR 0040): one job per recipient of one build's review request,
 * on the `notify` queue, so a refused delivery is retried for that recipient alone and the others
 * are never resent. The job holds references only (project, `eventId`, a channel id or a person
 * and provider); the handler re-resolves the recipient, the public origin and the build's review
 * cycle when it runs, so a stale or reordered job cannot notify someone who no longer applies.
 * Serverless hosts poll no queue and keep the direct, best-effort delivery (`notify.ts`).
 */
import {
  isFinalAttempt,
  NOTIFY_BACKOFF,
  NOTIFY_MAX_ATTEMPTS,
  type ConsumerJob,
  type KindHandler,
} from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import { BuildModel, CaptureJobModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { sanitizeErrorText } from "@storyshelf/core/utils";
import type { JobQueue } from "./job-queue.ts";
import {
  deliver,
  notifyDepsFor,
  originOrPause,
  recordOutcomes,
  resolveReviewTarget,
  reviewUrlFor,
  type NotifyDeps,
  type ReviewRequestJob,
  type ReviewTarget,
} from "./notify.ts";
import { assignedReviewersOf, assignmentReason } from "./review-assignment.ts";
import { reviewRequestedData } from "./review-events.ts";
import type { ServerRuntime } from "./runtime.ts";

const EVENT = "review:requested";

/** Longest error text kept on a channel row. */
const MAX_ERROR_LENGTH = 500;

/** What {@link setupReviewRequests} returns. */
export interface ReviewRequestWiring {
  /** Queues one request; undefined where this host polls no `notify` queue. */
  enqueue: NotifyDeps["reviewRequests"];
  /** Runs the jobs; null where this host polls no `notify` queue. */
  handler: KindHandler | null;
}

/** The identity of one request to one recipient: the idempotency key (`eventId` + target). */
export function reviewRequestKey(eventId: string, target: ReviewTarget): string {
  const who =
    target.kind === "channel"
      ? `channel:${target.channelId}`
      : `user:${target.userId}:${target.provider}`;
  return `${eventId}|${who}`;
}

/** The job's data when it is well-formed, else undefined. */
function parseJobData(data: Record<string, unknown> | undefined): ReviewRequestJob | undefined {
  const projectId = data?.["projectId"];
  const eventId = data?.["eventId"];
  const target = data?.["target"];
  if (typeof projectId !== "string" || typeof eventId !== "string" || !isTarget(target)) {
    return undefined;
  }
  return { projectId, eventId, target };
}

function isTarget(value: unknown): value is ReviewTarget {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record["kind"] === "channel"
    ? typeof record["channelId"] === "string"
    : record["kind"] === "user" &&
        typeof record["userId"] === "string" &&
        typeof record["provider"] === "string" &&
        ["subscription", "default", "assigned"].includes(String(record["route"]));
}

/** `<buildId>:<cycle>` → the build id (build ids hold no colon). */
function buildIdOf(eventId: string): string {
  return eventId.slice(0, Math.max(0, eventId.lastIndexOf(":")));
}

/** Whether a stored job row is the request `key` (any state: a delivered one is not repeated). */
function isRequest(payload: string | null, key: string): boolean {
  try {
    const stored: unknown = JSON.parse(payload ?? "{}");
    const data = (stored as { data?: Record<string, unknown> }).data;
    const job = parseJobData(data);
    return job !== undefined && reviewRequestKey(job.eventId, job.target) === key;
  } catch {
    return false;
  }
}

/**
 * Queue a request unless the build already has a job for the same `eventId` and target, in any
 * state. The build's review claim already admits one request per cycle; this makes a repeated
 * call (a retried publish, a boot replay) a no-op instead of a second message.
 */
export function createReviewRequestEnqueuer(
  deps: Pick<NotifyDeps, "db">,
  queue: Pick<JobQueue, "get">,
): (job: ReviewRequestJob) => Promise<void> {
  return async (job) => {
    const buildId = buildIdOf(job.eventId);
    const key = reviewRequestKey(job.eventId, job.target);
    const rows = await new CaptureJobModel(deps.db).listForBuild(buildId);
    if (rows.some((row) => row.kind === "review-request" && isRequest(row.payload, key))) {
      return;
    }
    await queue.get().enqueueJob({
      kind: "review-request",
      buildId,
      data: { projectId: job.projectId, eventId: job.eventId, target: job.target },
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      activeKey: `review-request:${key}`,
    });
  };
}

/** One request to one recipient, as it stands now. */
interface Request {
  project: Pick<Project, "id" | "slug">;
  channel: NotificationChannel;
  message: { event: string; data: Record<string, unknown>; reviewUrl: string };
}

/** The build while it still waits for this request's cycle verdict (what `claimReviewRequest` claimed on). */
async function waitingBuild(deps: NotifyDeps, eventId: string): Promise<Build | undefined> {
  const build = await new BuildModel(deps.db).get(buildIdOf(eventId));
  const waiting = build?.status === "pending" && reviewRequestedData(build)["eventId"] === eventId;
  return waiting ? build : undefined;
}

/** The request that is still worth sending, resolved at run time; undefined when nothing applies. */
async function currentRequest(
  deps: NotifyDeps,
  job: ReviewRequestJob,
): Promise<Request | undefined> {
  const project = await new ProjectModel(deps.db).get(job.projectId);
  const build = await waitingBuild(deps, job.eventId);
  const origin = project && build ? await originOrPause(deps, EVENT) : undefined;
  if (!project || !build || origin === undefined) {
    return undefined;
  }
  const data = reviewRequestedData(build);
  const because = await assignmentFor(deps, { project, build }, job.target);
  const channel =
    because === null ? undefined : await resolveReviewTarget(deps, project.id, job.target, data);
  return channel === undefined
    ? undefined
    : {
        project,
        channel,
        message: {
          event: EVENT,
          data: { ...data, ...because },
          reviewUrl: reviewUrlFor(origin, project.slug, `/builds/${build.id}`),
        },
      };
}

/**
 * The `assignedBecause` an assigned recipient's message carries (empty for anyone else), or null
 * when the recipient is now assigned and so gets the message from the assigned job, not this one.
 */
async function assignmentFor(
  deps: NotifyDeps,
  scope: { project: Project; build: Build },
  target: ReviewTarget,
): Promise<Record<string, string> | null> {
  if (target.kind === "channel") {
    return {};
  }
  const assigned = await assignedReviewersOf(deps.db, scope.project, scope.build);
  const reviewer = assigned.find((entry) => entry.userId === target.userId);
  if (target.route === "assigned") {
    return reviewer ? { assignedBecause: assignmentReason(reviewer.components) } : {};
  }
  return reviewer === undefined ? {} : null;
}

/** Deliver to one recipient; the delivery's error, if any (the notifiers report it, never throw). */
async function sendTo(deps: NotifyDeps, request: Request): Promise<string | undefined> {
  let failure: string | undefined;
  // oxlint-disable-next-line eslint/require-await -- the outcome callback is async by contract
  await deliver(deps, request.project, request.message, [request.channel], async (outcome) => {
    failure = outcome.error;
  });
  return failure;
}

/** Deliver a resolved request: a refusal records on the last attempt and throws so the queue retries. */
async function sendOrRetry(deps: NotifyDeps, job: ConsumerJob, request: Request): Promise<void> {
  const failure = await sendTo(deps, request);
  const channelId = request.channel.id;
  if (failure !== undefined && !isFinalAttempt(job)) {
    throw new Error(failure);
  }
  await recordOutcomes(deps)(failure === undefined ? { channelId } : { channelId, error: failure });
  if (failure !== undefined) {
    throw new Error(failure);
  }
}

/**
 * The handler. Resolving acks the job, also when nothing applies any more (the build moved on, the
 * recipient is gone, no origin is confirmed: a paused notification is not retried). A refused
 * delivery rejects, so the consumer requeues with {@link NOTIFY_BACKOFF}; the last attempt records
 * the error on the channel row. A failed review request raises no admin event: it is a message to
 * people, and the build's state is shown by its own `notify` jobs.
 */
export function createReviewRequestHandler(deps: NotifyDeps): KindHandler {
  return {
    accepts: (job) => parseJobData(job.data) !== undefined,
    backoff: NOTIFY_BACKOFF,
    run: async (job, context) => {
      const parsed = parseJobData(job.data);
      context.signal.throwIfAborted();
      const request = parsed === undefined ? undefined : await currentRequest(deps, parsed);
      if (request === undefined) {
        context.logger.info({ eventId: parsed?.eventId }, "review request no longer applies");
        return;
      }
      await sendOrRetry(deps, job, request);
    },
  };
}

/**
 * For the queue's `onExhausted` hook: a last attempt that lost its lease never ran its handler to
 * the end, so the failure is logged and, for a stored channel, shown on its row.
 */
export function reviewRequestExhausted(
  deps: NotifyDeps,
): (job: ConsumerJob, error: string) => Promise<void> {
  return async (job, error) => {
    const parsed = parseJobData(job.data);
    const text = sanitizeErrorText(error, MAX_ERROR_LENGTH);
    deps.logger.error(
      { buildId: job.buildId, eventId: parsed?.eventId, error: text },
      "review request given up",
    );
    if (parsed?.target.kind === "channel") {
      await recordOutcomes(deps)({ channelId: parsed.target.channelId, error: text });
    }
  };
}

/** Wire review requests: the enqueuer and handler on the `notify` queue, none when there is no queue. */
export function setupReviewRequests(
  options: ShelfOptions,
  runtime: ServerRuntime,
  jobs: JobQueue | null,
): ReviewRequestWiring {
  if (jobs === null) {
    return { enqueue: undefined, handler: null };
  }
  const deps = notifyDepsFor(options, runtime);
  jobs.exhausted["review-request"] = reviewRequestExhausted(deps);
  return {
    enqueue: createReviewRequestEnqueuer(deps, jobs),
    handler: createReviewRequestHandler(deps),
  };
}
