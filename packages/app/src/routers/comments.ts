import { z } from "@hono/zod-openapi";
import { CommentModel } from "@storyshelf/core/models";
import type { ShelfRouter } from "../app-types.ts";
import { notifyProject } from "../notify.ts";
import { getStore } from "../store.ts";
import { buildForProject } from "./builds.handlers.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject, notFound as throwNotFound } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import { DEVELOPER_ROLES, VIEW_ROLES } from "./roles.ts";
import { actionRouteDef, listRouteDef, postRouteDef } from "./route-defs.ts";
import { commentSchema, commentCreateSchema } from "./schemas.ts";
const buildParams = { buildId: z.string() };

const listCommentsRoute = listRouteDef({
  tag: "Review",
  summary: "List comments",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  params: buildParams,
  schema: commentSchema,
  description: "List comments on a build",
});

const createCommentRoute = postRouteDef({
  tag: "Review",
  summary: "Add a comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  params: buildParams,
  body: commentCreateSchema,
  schema: commentSchema,
  description: "Comment created",
});

const resolveCommentRoute = actionRouteDef({
  tag: "Review",
  summary: "Resolve a comment",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments/{commentId}/resolve",
  params: { ...buildParams, commentId: z.string() },
  schema: commentSchema,
  description: "Comment resolved",
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
    const body = c.req.valid("json");
    const userId = getStore().user?.id ?? null;
    const comment = await new CommentModel(getStore().db).create(
      project.id,
      build.id,
      userId,
      body,
    );
    await notifyProject(
      project,
      "comment:created",
      {
        buildId: build.id,
        commentId: comment.id,
        snapshotId: comment.snapshotId,
        body: comment.body.slice(0, 500),
      },
      `/builds/${build.id}`,
    );
    hxRefresh(c);
    flashHx(c, "Comment added");
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
    hxRefresh(c);
    flashHx(c, "Comment resolved");
    return c.json(comment);
  });
}
