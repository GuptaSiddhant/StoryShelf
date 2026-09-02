import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";

import { CommentModel } from "../models/comment.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject, notFound as throwNotFound } from "./helpers.ts";
import { commentSchema, commentCreateSchema, notFound, unauthorized } from "./schemas.ts";
import { VIEW_ROLES, DEVELOPER_ROLES, buildForProject } from "./builds.handlers.ts";

const listCommentsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: commentSchema.array() } }, description: "List comments on a build" },
    ...notFound,
    ...unauthorized,
  },
});

const createCommentRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: { content: { "application/json": { schema: commentCreateSchema } } },
  },
  responses: {
    201: { content: { "application/json": { schema: commentSchema } }, description: "Comment created" },
    ...notFound,
  },
});

const resolveCommentRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments/{commentId}/resolve",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), commentId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: commentSchema } }, description: "Comment resolved" },
    ...notFound,
  },
});

export function registerComments(app: ShelfApp): void {
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
    const body = c.req.valid("json");
    const userId = getStore().user?.id ?? "anonymous";
    const comment = await new CommentModel(getStore().db).create(project.id, build.id, userId, body);
    return c.json(comment, 201);
  });

  app.openapi(resolveCommentRoute, async (c) => {
    const { slug, buildId, commentId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const comment = await new CommentModel(getStore().db).resolve(commentId);
    if (comment.buildId !== build.id) {
      throwNotFound("Comment not found");
    }
    return c.json(comment);
  });
}