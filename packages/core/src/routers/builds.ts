import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";
import { HTTPException } from "hono/http-exception";

import { BuildModel } from "../models/build.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import { getStore } from "../store.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { badRequest, buildSchema, forbidden as forbiddenResponse, notFound as notFoundResponse, unauthorized } from "./schemas.ts";
import { VIEW_ROLES, DEVELOPER_ROLES, APPROVER_ROLES, buildUploadSchema, buildListQuery, buildForProject, asString } from "./builds.handlers.ts";
import { registerSnapshots } from "./snapshots.ts";
import { registerComments } from "./comments.ts";

const listBuildsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds",
  request: { params: z.object({ slug: z.string() }), query: buildListQuery },
  responses: {
    200: { content: { "application/json": { schema: buildSchema.array() } }, description: "List builds for a project" },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const createBuildRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "multipart/form-data": { schema: buildUploadSchema } } },
  },
  responses: {
    202: { content: { "application/json": { schema: buildSchema } }, description: "Build created and capture queued" },
    ...badRequest,
    ...forbiddenResponse,
    ...notFoundResponse,
  },
});

const getBuildRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: buildSchema } }, description: "Fetch a build" },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const retryBuildRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/retry",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    202: { content: { "application/json": { schema: buildSchema } }, description: "Build reset to pending" },
    ...notFoundResponse,
  },
});

const deleteBuildRoute = createRoute({
  method: "delete",
  path: "/api/v1/projects/{slug}/builds/{buildId}",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    204: { description: "Build deleted" },
    ...notFoundResponse,
  },
});

export function registerBuilds(app: ShelfApp): void {
  app.openapi(listBuildsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    const { status, branch } = c.req.valid("query");
    const builds = new BuildModel(getStore().db).list(project.id, { status, branch: branch ?? undefined });
    return c.json(await builds);
  });

  app.openapi(createBuildRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...DEVELOPER_ROLES);
    const form = await c.req.formData();

    const gitSha = asString(form.get("gitSha")) ?? "";
    const gitBranch = asString(form.get("gitBranch")) ?? "";
    if (!gitSha || !gitBranch) {
      throw new HTTPException(400, { message: "gitSha and gitBranch are required" });
    }
    const authorEmail = asString(form.get("authorEmail"));
    const authorName = asString(form.get("authorName"));
    const message = asString(form.get("message"));

    const build = await new BuildModel(getStore().db).create(project.id, {
      gitSha,
      gitBranch,
      isDefault: gitBranch === project.gitDefaultBranch,
      authorEmail,
      authorName,
      message,
    });

    await emitWebhookEvent(getStore().db, project.id, "build:created", {
      buildId: build.id,
      gitSha,
      gitBranch,
      authorEmail,
      authorName,
      message,
    });

    const zip = form.get("zip");
    if (zip && typeof zip !== "string") {
      const buffer = Buffer.from(await zip.arrayBuffer());
      await getStore().storage.write(storybookZipPath(project.id, build.id), buffer);
    }

    const reqId = c.get("requestId");
    await getStore().enqueueCapture?.(build.id, reqId);
    return c.json(build, 202);
  });

  app.openapi(getBuildRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    return c.json(build);
  });

  app.openapi(retryBuildRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const updated = await new BuildModel(getStore().db).setStatus(build.id, "pending");
    return c.json(updated, 202);
  });

  app.openapi(deleteBuildRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    await new BuildModel(getStore().db).remove(build.id);
    return c.body(null, 204);
  });

  registerSnapshots(app);
  registerComments(app);
}