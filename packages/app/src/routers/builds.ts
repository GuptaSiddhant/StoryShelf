import { createRoute, z } from "@hono/zod-openapi";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@storyshelf/core/config";
import { BuildModel } from "@storyshelf/core/models";
import { storybookZipPath } from "@storyshelf/core/utils";
import { buildLabels, builds as buildsTable, snapshots } from "@storyshelf/db-sqlite/schema";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { registerAttempts } from "./attempts.ts";
import {
  VIEW_ROLES,
  DEVELOPER_ROLES,
  APPROVER_ROLES,
  buildCreateJsonSchema,
  buildListQuery,
  buildForProject,
  createBuildRecord,
  persistInlineStatics,
  storeUploadStream,
} from "./builds.handlers.ts";

async function upsertContentRef(hash: string): Promise<void> {
  try {
    const { contentRefs } = await import("@storyshelf/db-sqlite/schema");
    const now = new Date().toISOString();
    const existing = await getStore().db.get(contentRefs as never, hash);
    if (existing) {
      await getStore().db.update(contentRefs as never, hash, {
        refCount: (existing as { refCount: number }).refCount + 1,
        lastSeenAt: now,
      } as never);
    } else {
      await getStore().db.insert(
        contentRefs as never,
        {
          hash,
          refCount: 1,
          lastSeenAt: now,
          createdAt: now,
        } as never,
      );
    }
  } catch {
    // ignore — content_refs may not exist on old DB
  }
}
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
/** Register the build list, upload, fetch, retry, and delete endpoints. */
export function registerBuilds(app: ShelfRouter): void {
  app.openapi(listBuildsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    const { status, branch, labelKey, labelValue } = c.req.valid("query");
    const builds = new BuildModel(getStore().db, {
      builds: buildsTable,
      buildLabels,
      snapshots,
    }).list(project.id, {
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
    const { storage, config, logger } = getStore();
    await persistInlineStatics(
      storage,
      config.scratchDir,
      config.maxInlineUnzipSize,
      c.req.header("content-length"),
      project.id,
      build.id,
      logger,
    );
    return c.json(build, 202);
  });

  app.openapi(dedupRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    await buildForProject(project.id, buildId);
    const { hashes } = c.req.valid("json");
    const needed: string[] = [];
    for (const hash of hashes) {
      if (!(await getStore().storage.exists(`content/${hash}`))) {
        needed.push(hash);
      }
    }
    return c.json({ needed });
  });

  // oxlint-disable eslint(max-depth) -- dedup upload handler is intentionally nested for batch handling
  app.openapi(contentUploadRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    await buildForProject(project.id, buildId);
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("multipart/")) {
      const form = await c.req.formData();
      for (const [key, value] of form.entries()) {
        if (value instanceof File) {
          const hash = key;
          const buffer = Buffer.from(await value.arrayBuffer());
          await getStore().storage.write(`content/${hash}`, buffer);
          await upsertContentRef(hash);
        }
      }
    } else {
      // Single content upload via PUT with hash header
      const hash = c.req.header("x-content-hash") ?? "";
      if (!hash) throw new HTTPException(400, { message: "Missing X-Content-Hash" });
      const buffer = Buffer.from(await c.req.arrayBuffer());
      await getStore().storage.write(`content/${hash}`, buffer);
    }
    return c.json({ ok: true });
  });

  app.openapi(manifestRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const { files } = c.req.valid("json");
    const manifest: Record<string, string> = {};
    for (const f of files) {
      manifest[f.rel] = f.hash;
    }
    await getStore().storage.write(
      `${project.id}/builds/${build.id}/storybook/manifest.json`,
      Buffer.from(JSON.stringify(manifest)),
    );
    // Upsert content_refs for each hash
    for (const f of files) {
      try {
        const { contentRefs } = await import("@storyshelf/db-sqlite/schema");
        const now = new Date().toISOString();
        const existing = await getStore().db.get(contentRefs as never, f.hash);
        // oxlint-disable-next-line unicorn/no-if-else -- upsert is clearer as if/else
        if (!existing) {
          await getStore().db.insert(
            contentRefs as never,
            {
              hash: f.hash,
              refCount: 1,
              lastSeenAt: now,
              createdAt: now,
            } as never,
          );
        } else {
          await getStore().db.update(contentRefs as never, f.hash, {
            lastSeenAt: now,
          } as never);
        }
      } catch {
        // ignore — content_refs may not exist
      }
    }
    const reqId = c.get("requestId");
    await getStore().enqueueCapture?.(build.id, reqId);
    return c.json({ ok: true });
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
    const updated = await new BuildModel(getStore().db, {
      builds: buildsTable,
      buildLabels,
      snapshots,
    }).setStatus(build.id, "pending");
    await getStore().enqueueCapture?.(build.id, c.get("requestId"));
    return c.json(updated, 202);
  });

  app.openapi(deleteBuildRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    await new BuildModel(getStore().db, { builds: buildsTable, buildLabels, snapshots }).remove(
      build.id,
    );
    return c.body(null, 204);
  });

  registerSnapshots(app);
  registerComments(app);
  registerAttempts(app);
}

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

const dedupHashesSchema = z.object({ hashes: z.array(z.string()) });
const dedupNeededSchema = z.object({ needed: z.array(z.string()) });
const dedupRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/dedup",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: { content: { "application/json": { schema: dedupHashesSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: dedupNeededSchema } },
      description: "Hashes needed for upload",
    },
    ...notFoundResponse,
  },
});

const contentUploadRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/content",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: { content: { "multipart/form-data": { schema: z.any() } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      description: "Content uploaded",
    },
    ...notFoundResponse,
  },
});

const manifestFileSchema = z.object({ rel: z.string(), hash: z.string(), size: z.number() });
const manifestRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/manifest",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ files: z.array(manifestFileSchema) }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      description: "Manifest stored",
    },
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
      description: "Build reset to pending and capture re-queued (new attempt)",
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
