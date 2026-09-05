import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { DEFAULT_MAX_UPLOAD_BYTES } from "../config.ts";
import type { ShelfApp } from "../index.tsx";
import { BuildModel } from "../models/build.ts";
import { getStore } from "../store.ts";
import { storybookZipPath } from "../utils/paths.ts";
import {
  VIEW_ROLES,
  DEVELOPER_ROLES,
  APPROVER_ROLES,
  buildCreateJsonSchema,
  buildListQuery,
  buildForProject,
  createBuildRecord,
  storeUploadStream,
} from "./builds.handlers.ts";
import { registerComments } from "./comments.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import {
  badRequest,
  buildSchema,
  forbidden as forbiddenResponse,
  notFound as notFoundResponse,
  unauthorized,
} from "./schemas.ts";
import { registerSnapshots } from "./snapshots.ts";

const listBuildsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds",
  request: { params: z.object({ slug: z.string() }), query: buildListQuery },
  responses: {
    200: {
      content: { "application/json": { schema: buildSchema.array() } },
      description: "List builds for a project",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const buildCreatedSchema = z
  .object({ build: buildSchema, uploadUrl: z.string() })
  .openapi("BuildCreated");

const createBuildRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds",
  request: {
    params: z.object({ slug: z.string() }),
    body: {
      content: {
        "application/json": { schema: buildCreateJsonSchema },
      },
    },
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: buildCreatedSchema,
        },
      },
      description: "Build created. PUT the Storybook zip to uploadUrl to queue capture.",
    },
    ...badRequest,
    ...forbiddenResponse,
    ...notFoundResponse,
  },
});

const uploadZipRoute = createRoute({
  method: "put",
  path: "/api/v1/projects/{slug}/builds/{buildId}/zip",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: {
      content: {
        "application/zip": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
  },
  responses: {
    202: {
      content: { "application/json": { schema: buildSchema } },
      description: "Zip stored and capture queued",
    },
    413: {
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }).openapi("Error"),
        },
      },
      description: "Upload exceeds the configured size limit",
    },
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
    202: {
      content: { "application/json": { schema: buildSchema } },
      description: "Build reset to pending",
    },
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

/** Register the build list, upload, fetch, retry, and delete endpoints. */
export function registerBuilds(app: ShelfApp): void {
  app.openapi(listBuildsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    const { status, branch, labelKey, labelValue } = c.req.valid("query");
    const builds = new BuildModel(getStore().db).list(project.id, {
      status,
      branch: branch ?? undefined,
      labelKey: labelKey ?? undefined,
      labelValue: labelValue ?? undefined,
    });
    return c.json(await builds);
  });

  app.openapi(createBuildRoute, async (c) => {
    const project = await resolveAuthorizedProject(
      c,
      c.req.valid("param").slug,
      ...DEVELOPER_ROLES,
    );
    const parsed = buildCreateJsonSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.message });
    }
    const build = await createBuildRecord(project, parsed.data);
    const uploadUrl = `/api/v1/projects/${project.slug}/builds/${build.id}/zip`;
    return c.json({ build, uploadUrl }, 202);
  });

  app.openapi(uploadZipRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const maxBytes = getStore().config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    await storeUploadStream(
      getStore().storage,
      storybookZipPath(project.id, build.id),
      c.req.raw.body,
      maxBytes,
    );

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
