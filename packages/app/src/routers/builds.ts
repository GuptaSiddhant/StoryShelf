import { createRoute, z } from "@hono/zod-openapi";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@storyshelf/core/config";
import { BuildModel, PackageUsageModel } from "@storyshelf/core/models";
import { storybookZipPath } from "@storyshelf/core/utils";
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
  storeUploadStream,
} from "./builds.handlers.ts";
import { discardZip, planUpload, publishUpload } from "./publish-upload.ts";

/** Decide how the stored zip is published; a zip this host cannot publish is removed and refused. */
async function planOrDiscard(
  zipBytes: number,
  projectId: string,
  buildId: string,
): Promise<"inline" | "job"> {
  try {
    return planUpload(zipBytes);
  } catch (error) {
    await discardZip(projectId, buildId);
    throw error;
  }
}

async function upsertContentRef(hash: string): Promise<void> {
  try {
    const contentRefs = getStore().db.tables.contentRefs;
    const now = new Date().toISOString();
    const existing = await getStore().db.get(contentRefs, hash);
    if (existing) {
      await getStore().db.update(contentRefs, hash, {
        refCount: (existing as { refCount: number }).refCount + 1,
        lastSeenAt: now,
      });
    } else {
      await getStore().db.insert(contentRefs, {
        hash,
        refCount: 1,
        lastSeenAt: now,
        createdAt: now,
      });
    }
  } catch {
    // ignore — content_refs may not exist on old DB
  }
}
import { registerBuildChangeset } from "./build-changeset.ts";
import { registerBuildReviews } from "./build-reviews.ts";
import { registerComments } from "./comments.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
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
    const build = await createBuildRecord(project, c.req.valid("json"));
    const uploadUrl = `/api/v1/projects/${project.slug}/builds/${build.id}/zip`;
    return c.json(
      { build, uploadUrl, baselineSha: build.baselineSha, testing: getStore().testing },
      202,
    );
  });

  app.openapi(affectedRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const { baselineSha, changedFiles, affectedImportPaths } = c.req.valid("json");
    const updated = await new BuildModel(getStore().db).setAffected(build.id, {
      baselineSha,
      changedFiles,
      affectedImportPaths,
    });
    return c.json(updated);
  });

  app.openapi(usageRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const { usage } = c.req.valid("json");
    const stored = await new PackageUsageModel(getStore().db).replaceForBuild(
      project.id,
      build.id,
      usage,
    );
    return c.json({ stored });
  });

  app.openapi(uploadZipRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const maxBytes = getStore().config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    const zipBytes = await storeUploadStream(
      getStore().storage,
      storybookZipPath(project.id, build.id),
      c.req.raw.body,
      maxBytes,
    );
    const route = await planOrDiscard(zipBytes, project.id, build.id);
    const reqId = c.get("requestId");
    await getStore().enqueueCapture?.(build.id, reqId);
    return c.json(await publishUpload(route, build, reqId), 202);
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
        const contentRefs = getStore().db.tables.contentRefs;
        const now = new Date().toISOString();
        const existing = await getStore().db.get(contentRefs, f.hash);
        // oxlint-disable-next-line unicorn/no-if-else -- upsert is clearer as if/else
        if (!existing) {
          await getStore().db.insert(contentRefs, {
            hash: f.hash,
            refCount: 1,
            lastSeenAt: now,
            createdAt: now,
          });
        } else {
          await getStore().db.update(contentRefs, f.hash, {
            lastSeenAt: now,
          });
        }
      } catch {
        // ignore — content_refs may not exist
      }
    }
    // The files are stored content-addressed: nothing to extract, so publishing is complete.
    await getStore().publish?.completer.complete(build.id, { ok: true });
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
    const updated = await new BuildModel(getStore().db).setStatus(build.id, "pending");
    await getStore().enqueueCapture?.(build.id, c.get("requestId"));
    hxRefresh(c);
    flashHx(c, "Capture queued");
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
  registerBuildReviews(app);
  registerBuildChangeset(app);
  registerAttempts(app);
}

const listBuildsRoute = createRoute({
  method: "get",
  tags: ["Builds"],
  summary: "List builds",
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
  .object({
    build: buildSchema,
    uploadUrl: z.string(),
    baselineSha: z.string().nullable(),
    testing: z.boolean().openapi({
      description:
        "False when the server has no `testing` option: the build is published but never captured or compared.",
    }),
  })
  .openapi("BuildCreated");

const createBuildRoute = createRoute({
  method: "post",
  tags: ["Builds"],
  summary: "Create a build",
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
      description:
        "Build created. PUT the Storybook zip to uploadUrl to publish it (and queue capture when testing is on).",
    },
    ...badRequest,
    ...forbiddenResponse,
    ...notFoundResponse,
  },
});

const uploadZipRoute = createRoute({
  method: "put",
  tags: ["Builds"],
  summary: "Upload the Storybook zip",
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
      description:
        "Zip stored. A zip up to maxInlineUnzipSize (default 50 MB) is extracted inline in this request; a larger one is published by a background job. With testing off, the build becomes approved when publishing finishes on the project's default branch (failed if it cannot be published) and stays pending on other branches; with testing on, capture sets the status.",
    },
    413: {
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }).openapi("Error"),
        },
      },
      description:
        "Upload exceeds the configured size limit, or the zip is over the inline limit and this host (serverless) runs no publish consumer: upload file by file instead (POST /dedup, PUT /content, POST /manifest)",
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
  tags: ["Builds"],
  summary: "Check which files need uploading",
  description:
    "File-by-file upload, step 1 (dedup, content, manifest): needs no zip extraction and works on any host, serverless included. Send the content hashes; the response lists those the server does not hold yet.",
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
  tags: ["Builds"],
  summary: "Upload build content",
  description:
    "File-by-file upload, step 2: store the missing files content-addressed (multipart, or one file with an X-Content-Hash header).",
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
  tags: ["Builds"],
  summary: "Store the build manifest",
  description:
    "File-by-file upload, step 3: store the path-to-hash manifest. This completes publishing. With testing off the build becomes approved when it is on the project's default branch and stays pending on other branches; with testing on, a capture is queued and sets the status.",
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

const affectedPayloadSchema = z.object({
  baselineSha: z.string().nullable(),
  changedFiles: z.array(z.string()).max(20_000),
  affectedImportPaths: z.array(z.string()).max(20_000).nullable(),
});
const affectedRoute = createRoute({
  method: "post",
  tags: ["Builds"],
  summary: "Record the affected stories",
  path: "/api/v1/projects/{slug}/builds/{buildId}/affected",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: { content: { "application/json": { schema: affectedPayloadSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: buildSchema } },
      description: "Affected set recorded",
    },
    ...badRequest,
    ...forbiddenResponse,
    ...notFoundResponse,
  },
});

const usagePayloadSchema = z.object({
  usage: z
    .array(
      z.object({
        storyImportPath: z.string().min(1).max(1024),
        packageName: z.string().min(1).max(214),
        modulePath: z.string().min(1).max(2048),
        version: z.string().max(128).nullable().optional(),
      }),
    )
    .max(20_000),
});
const usageRoute = createRoute({
  method: "post",
  tags: ["Builds"],
  summary: "Record the dependency packages each story uses",
  path: "/api/v1/projects/{slug}/builds/{buildId}/usage",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    body: { content: { "application/json": { schema: usagePayloadSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ stored: z.number() }) } },
      description: "Usage recorded (replaces any earlier report for the build)",
    },
    ...badRequest,
    ...forbiddenResponse,
    ...notFoundResponse,
  },
});

const getBuildRoute = createRoute({
  method: "get",
  tags: ["Builds"],
  summary: "Get a build",
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
  tags: ["Builds"],
  summary: "Retry capture",
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
  tags: ["Builds"],
  summary: "Delete a build",
  path: "/api/v1/projects/{slug}/builds/{buildId}",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    204: { description: "Build deleted" },
    ...notFoundResponse,
  },
});
