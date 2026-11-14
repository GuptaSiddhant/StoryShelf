/**
 * What a `review-request` job holds and how it is queued (ADR 0040): the idempotency key
 * (`eventId` + target), the parse of a stored job's data, and the enqueuer that skips a request the
 * build already has a job for. References only: never an address, URL or secret.
 */
import { NOTIFY_MAX_ATTEMPTS } from "@storyshelf/core/capture";
import { CaptureJobModel } from "@storyshelf/core/models";
import type { JobQueue } from "./job-queue.ts";
import type { NotifyDeps, ReviewRequestJob, ReviewTarget } from "./notify.ts";

/** The identity of one request to one recipient: the idempotency key (`eventId` + target). */
export function reviewRequestKey(eventId: string, target: ReviewTarget): string {
  const who =
    target.kind === "channel"
      ? `channel:${target.channelId}`
      : `user:${target.userId}:${target.provider}${target.deviceId === undefined ? "" : `:${target.deviceId}`}`;
  return `${eventId}|${who}`;
}

/** The job's data when it is well-formed, else undefined. */
export function parseJobData(
  data: Record<string, unknown> | undefined,
): ReviewRequestJob | undefined {
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
        (record["deviceId"] === undefined || typeof record["deviceId"] === "string") &&
        ["subscription", "default", "assigned"].includes(String(record["route"]));
}

/** `<buildId>:<cycle>` → the build id (build ids hold no colon). */
export function buildIdOf(eventId: string): string {
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
