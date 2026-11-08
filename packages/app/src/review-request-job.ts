/**
 * The `review-request` job kind (ADR 0040): one job per recipient of one build's review request,
 * on the `notify` queue, so a refused delivery is retried for that recipient alone and the others
 * are never resent. The job holds references only (project, `eventId`, a channel id or a person
 * and provider); the handler re-resolves the recipient, the public origin and the build's review
 * cycle when it runs, so a stale or reordered job cannot notify someone who no longer applies.
 * Serverless hosts poll no queue and keep the direct, best-effort delivery (`notify.ts`).
 */
import type { NotificationChannel } from "@storyshelf/core/adapter/notifier";
import {
  isFinalAttempt,
  NOTIFY_BACKOFF,
  type ConsumerJob,
  type KindHandler,
} from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
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
import { buildIdOf, createReviewRequestEnqueuer, parseJobData } from "./review-request-data.ts";
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
  const now = await assignmentFor(deps, { project, build }, job.target);
  const channel =
    now === null ? undefined : await resolveReviewTarget(deps, project.id, now.target, data);
  return channel === undefined
    ? undefined
    : {
        project,
        channel,
        message: {
          event: EVENT,
          data: { ...data, ...now?.because },
          reviewUrl: reviewUrlFor(origin, project.slug, `/builds/${build.id}`),
        },
      };
}

/**
 * How the recipient is addressed now. A person assigned since the job was queued is addressed as
 * assigned (with the reason), whatever route queued them; one no longer assigned who was queued as
 * assigned is dropped (null): removed from the project, or the owner rules changed.
 */
async function assignmentFor(
  deps: NotifyDeps,
  scope: { project: Project; build: Build },
  target: ReviewTarget,
): Promise<{ target: ReviewTarget; because: Record<string, string> } | null> {
  if (target.kind === "channel") {
    return { target, because: {} };
  }
  const assigned = await assignedReviewersOf(deps.db, scope.project, scope.build);
  const reviewer = assigned.find((entry) => entry.userId === target.userId);
  if (reviewer !== undefined) {
    const because = { assignedBecause: assignmentReason(reviewer.components) };
    return { target: { ...target, route: "assigned" }, because };
  }
  return target.route === "assigned" ? null : { target, because: {} };
}

/** Deliver to one recipient; whether a delivery was attempted, and its error (notifiers report, never throw). */
async function sendTo(
  deps: NotifyDeps,
  request: Request,
): Promise<{ attempted: boolean; failure?: string }> {
  const result: { attempted: boolean; failure?: string } = { attempted: false };
  // oxlint-disable-next-line eslint/require-await -- the outcome callback is async by contract
  await deliver(deps, request.project, request.message, [request.channel], async (outcome) => {
    result.attempted = true;
    if (outcome.error !== undefined) {
      result.failure = outcome.error;
    }
  });
  return result;
}

/**
 * Deliver a resolved request: a refusal records on the last attempt and throws so the queue
 * retries. A channel the core fan-out skipped (a state-only kind) was never attempted, so it
 * records nothing, success included.
 */
async function sendOrRetry(deps: NotifyDeps, job: ConsumerJob, request: Request): Promise<void> {
  const { attempted, failure } = await sendTo(deps, request);
  const channelId = request.channel.id;
  if (!attempted) {
    return;
  }
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
