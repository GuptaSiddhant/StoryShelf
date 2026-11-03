import { createRoute, z } from "@hono/zod-openapi";
import { CommentModel, type CommentCreateInput } from "@storyshelf/core/models";
import type { Comment, Project } from "@storyshelf/core/schema";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { REVIEW_EVENTS, announceReview } from "../review-events.ts";
import { getStore } from "../store.ts";
import { VIEW_ROLES, DEVELOPER_ROLES, buildForProject } from "./builds.handlers.ts";
import { resolveTriager } from "./comment-triage.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject, notFound as throwNotFound } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import { commentSchema, commentCreateSchema, notFound, unauthorized } from "./schemas.ts";
const listCommentsRoute = createRoute({
  method: "get",
  tags: ["Review"],
  summary: "List comments",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: commentSchema.array() } },
      description: "List comments on a build",
    },
    ...notFound,
    ...unauthorized,
  },
});

const createCommentRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Add a comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: { content: { "application/json": { schema: commentCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: commentSchema } },
      description: "Comment created",
    },
    ...notFound,
  },
});

const resolveCommentRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Resolve a comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments/{commentId}/resolve",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), commentId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: commentSchema } },
      description: "Comment resolved",
    },
    ...notFound,
  },
});

const reopenCommentRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Reopen a resolved comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments/{commentId}/reopen",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), commentId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: commentSchema } },
      description: "Comment reopened",
    },
    ...notFound,
  },
});

/** Register the build comment list, create, resolve and reopen endpoints. */
export function registerComments(app: ShelfRouter): void {
  app.openapi(listCommentsRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    return c.json(await new CommentModel(getStore().db).listByBuild(build.id));
  });

  app.openapi(createCommentRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const comment = await createComment(project, build.id, c.req.valid("json"));
    hxRefresh(c);
    flashHx(c, "Comment added");
    return c.json(comment, 201);
  });

  app.openapi(resolveCommentRoute, async (c) => {
    const { slug, buildId, commentId } = c.req.valid("param");
    const { build } = await resolveTriager(c, slug, buildId);
    const comment = await resolveBuildComment(build.id, commentId);
    hxRefresh(c);
    flashHx(c, "Comment resolved");
    return c.json(comment);
  });

  app.openapi(reopenCommentRoute, async (c) => {
    const { slug, buildId, commentId } = c.req.valid("param");
    const { build } = await resolveTriager(c, slug, buildId);
    const comment = await reopenBuildComment(build.id, commentId);
    hxRefresh(c);
    flashHx(c, "Comment reopened");
    return c.json(comment);
  });
}

/** A comment of `buildId`; 404 for a comment of another build. */
async function commentOfBuild(buildId: string, commentId: string): Promise<Comment> {
  const found = (await new CommentModel(getStore().db).listByBuild(buildId)).find(
    (item) => item.id === commentId,
  );
  return found ?? throwNotFound("Comment not found");
}

/** Mark a comment of `buildId` resolved by the current user; 404 for a comment of another build. */
export async function resolveBuildComment(buildId: string, commentId: string): Promise<Comment> {
  await commentOfBuild(buildId, commentId);
  return await new CommentModel(getStore().db).resolve(commentId, getStore().user?.id ?? null);
}

/** Open a resolved comment of `buildId` again; 404 for a comment of another build. */
export async function reopenBuildComment(buildId: string, commentId: string): Promise<Comment> {
  await commentOfBuild(buildId, commentId);
  return await new CommentModel(getStore().db).reopen(commentId);
}

/** A comment anchors to the build, a story or a snapshot (ADR 0013, decision 2), never two. */
function assertOneAnchor(body: {
  snapshotId?: string | undefined;
  storyId?: string | undefined;
}): void {
  if (body.snapshotId !== undefined && body.storyId !== undefined) {
    throw new HTTPException(400, {
      message: "A comment anchors to the build, a story or a snapshot, not several",
    });
  }
}

/** Where a comment is anchored: its snapshot, else its story, else the build. */
export function commentScope(comment: Comment): "build" | "story" | "snapshot" {
  if (comment.snapshotId !== null) {
    return "snapshot";
  }
  return comment.storyId === null ? "build" : "story";
}

/**
 * Every comment raises one `comment:created` (ADR 0013, decision 10), anchored by `scope`.
 * `review:comment` is a subscription alias for the build and story scopes, not a second event.
 * `eventId` is the comment id, so a retried delivery carries the same id.
 */
async function announceComment(project: Project, buildId: string, comment: Comment): Promise<void> {
  const data = {
    eventId: comment.id,
    scope: commentScope(comment),
    buildId,
    commentId: comment.id,
    snapshotId: comment.snapshotId,
    storyId: comment.storyId,
    kind: comment.kind,
    body: comment.body.slice(0, 500),
  };
  await announceReview(project, REVIEW_EVENTS.commentCreated, data, buildId);
}

export async function createComment(
  project: Project,
  buildId: string,
  body: CommentCreateInput,
): Promise<Comment> {
  assertOneAnchor(body);
  const userId = getStore().user?.id ?? null;
  const comment = await new CommentModel(getStore().db).create(project.id, buildId, userId, body);
  await announceComment(project, buildId, comment);
  return comment;
}
