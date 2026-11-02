/**
 * Review events (ADR 0013, decisions 4 and 10; ADR 0014, decision 10). They ride the existing
 * paths: signed webhooks to the project's subscribers and the notification fan-out (stored
 * channels plus per-user subscriptions). There is no new transport.
 *
 * - `review:requested`: a build is waiting for a verdict. Default-on for the project's approvers
 *   and admins (see `notify.ts`).
 * - `comment:created`: every comment, the one canonical event; `data.scope` is `build`, `story` or
 *   `snapshot`. `review:comment` is only a filter alias for the build and story scopes (see
 *   `eventMatches` in `notify.ts`), never emitted.
 * - `review:verdict`: a reviewer approved or rejected a build.
 */
import { emitWebhookEvent } from "@storyshelf/core/adapter/webhook-events";
import type { Build, Project } from "@storyshelf/core/schema";
import { credentialKeys } from "./credential-keys.ts";
import {
  COMMENT_CREATED,
  notifyProjectWith,
  REVIEW_COMMENT_ALIAS,
  type NotifyDeps,
} from "./notify.ts";
import { getStore } from "./store.ts";

/** Event names of the review topics. `comment` is the alias, `commentCreated` the emitted event. */
export const REVIEW_EVENTS = {
  requested: "review:requested",
  comment: REVIEW_COMMENT_ALIAS,
  commentCreated: COMMENT_CREATED,
  verdict: "review:verdict",
} as const;

/** Events a review announcement raises: the alias `review:comment` is never one of them. */
export type AnnouncedReviewEvent = Exclude<
  (typeof REVIEW_EVENTS)[keyof typeof REVIEW_EVENTS],
  typeof REVIEW_COMMENT_ALIAS
>;

/** Webhook and notification fan-out for one review event, from explicit dependencies. */
export async function announceReviewWith(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  event: AnnouncedReviewEvent,
  data: Record<string, unknown>,
  buildId: string,
): Promise<void> {
  await emitWebhookEvent(
    deps.db,
    { webhooks: deps.db.tables.webhooks },
    project.id,
    event,
    data,
    credentialKeys(deps.config),
    deps.logger,
  );
  await notifyProjectWith(deps, project, event, data, `/builds/${buildId}`);
}

/** {@link announceReviewWith} inside a request. */
export async function announceReview(
  project: Pick<Project, "id" | "slug">,
  event: AnnouncedReviewEvent,
  data: Record<string, unknown>,
  buildId: string,
): Promise<void> {
  await announceReviewWith(getStore(), project, event, data, buildId);
}

/**
 * What `review:requested` carries: the build to look at. `eventId` is `<buildId>:<cycle>`, so every
 * delivery of one cycle's request, retries included, has the same identity, and a reopened build
 * (a new cycle) a new one.
 */
export function reviewRequestedData(build: Build): Record<string, unknown> {
  return {
    eventId: `${build.id}:${String(build.reviewCycle ?? 0)}`,
    buildId: build.id,
    gitSha: build.gitSha,
    gitBranch: build.gitBranch,
    authorName: build.authorName,
    authorEmail: build.authorEmail,
    message: build.message,
  };
}
