/** Comment and build-verdict schemas. */
import { z } from "@hono/zod-openapi";
import { BUILD_STATUSES, COMMENT_KINDS, REVIEW_VERDICTS } from "@storyshelf/core/types";

/** OpenAPI schema for a build comment. */
export const commentSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    buildId: z.string(),
    snapshotId: z.string().nullable(),
    /** Storybook story id of a story-anchored comment. */
    storyId: z.string().nullable().optional(),
    userId: z.string().nullable(),
    body: z.string(),
    parentId: z.string().nullable(),
    /** The project members the body `@`-mentions, resolved when it was posted (never client input). */
    mentions: z.array(z.object({ userId: z.string(), handle: z.string() })),
    resolved: z.boolean(),
    /** `change_request` asks the build's author to address the comment; resolve it when done. */
    kind: z.enum(COMMENT_KINDS),
    resolvedAt: z.string().nullable(),
    resolvedBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Comment");

/** OpenAPI schema for creating a build comment. */
export const commentCreateSchema = z
  .object({
    body: z.string().min(1),
    /** Anchor to a snapshot; not together with `storyId`. */
    snapshotId: z.string().optional(),
    /** Anchor to a story of the build; not together with `snapshotId`. */
    storyId: z.string().min(1).optional(),
    parentId: z.string().optional(),
    /** `change_request` marks it as one the author is asked to address (default `comment`). */
    kind: z.enum(COMMENT_KINDS).optional(),
  })
  .openapi("CommentCreateInput");

/** OpenAPI schema for a build-level review verdict. */
export const buildReviewSchema = z
  .object({
    id: z.string(),
    buildId: z.string(),
    userId: z.string().nullable(),
    verdict: z.enum(REVIEW_VERDICTS),
    body: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("BuildReview");

/** OpenAPI schema for giving a build a verdict. */
export const buildReviewCreateSchema = z
  .object({
    verdict: z.enum(REVIEW_VERDICTS),
    body: z.string().max(4000).optional(),
  })
  .openapi("BuildReviewInput");

/** OpenAPI schema for a build's review state: the verdicts and what they make of the build. */
export const buildReviewStateSchema = z
  .object({
    /** Build status now. */
    status: z.enum(BUILD_STATUSES),
    /** Approvals the project requires. */
    approvalsRequired: z.number(),
    /** Approvals among the reviewers' latest verdicts. */
    approvals: z.number(),
    /** Every reviewer's latest verdict. */
    latest: buildReviewSchema.array(),
    /** Every verdict given, oldest first. */
    history: buildReviewSchema.array(),
  })
  .openapi("BuildReviewState");
