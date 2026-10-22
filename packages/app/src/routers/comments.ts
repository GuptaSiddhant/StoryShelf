import { createRoute, z } from "@hono/zod-openapi";
import { CommentModel, type CommentCreateInput } from "@storyshelf/core/models";
import type { Comment, Project } from "@storyshelf/core/schema";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { notifyProject } from "../notify.ts";
import { REVIEW_EVENTS, announceReview } from "../review-events.ts";
import { getStore } from "../store.ts";
import { VIEW_ROLES, DEVELOPER_ROLES, buildForProject } from "./builds.handlers.ts";
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

/** Register the build comment list, create, and resolve endpoints. */
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
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const comment = await resolveBuildComment(build.id, commentId);
    hxRefresh(c);
    flashHx(c, "Comment resolved");
    return c.json(comment);
  });
}

/** Mark a comment of `buildId` resolved; 404 for a comment of another build. */
export async function resolveBuildComment(buildId: string, commentId: string): Promise<Comment> {
  const comments = new CommentModel(getStore().db);
  const found = (await comments.listByBuild(buildId)).find((item) => item.id === commentId);
  if (!found) {
    throwNotFound("Comment not found");
  }
  return await comments.resolve(commentId);
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

/**
 * Snapshot comments keep `comment:created`; build and story comments, the review ones, raise
 * `review:comment` (webhook and notifications, ADR 0013, decision 10). One event per comment.
 */
async function announceComment(project: Project, buildId: string, comment: Comment): Promise<void> {
  const data = {
    buildId,
    commentId: comment.id,
    snapshotId: comment.snapshotId,
    storyId: comment.storyId,
    body: comment.body.slice(0, 500),
  };
  if (comment.snapshotId === null) {
    await announceReview(project, REVIEW_EVENTS.comment, data, buildId);
    return;
  }
  await notifyProject(project, "comment:created", data, `/builds/${buildId}`);
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
