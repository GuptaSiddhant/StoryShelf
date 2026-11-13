import { createRoute, z } from "@hono/zod-openapi";
import { ContentCollectingError, recordContentUses } from "@storyshelf/core/capture";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@storyshelf/core/config";
import { BuildModel, PackageUsageModel } from "@storyshelf/core/models";
import {
  CONTENT_HASH_PATTERN,
  contentKey,
  isContentHash,
  storybookZipPath,
} from "@storyshelf/core/utils";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
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

/** SHA-256 of the manifest with its paths sorted, so the same files hash the same in any order. */
function manifestHash(manifest: Record<string, string>): string {
  const sorted = Object.entries(manifest).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/**
 * Write-once publish: the first manifest of a build claims it and publishes; the same one again
 * resolves false (nothing to do) and another is a 409. A publish that fails gives the claim back.
 */
async function publishManifest(
  projectId: string,
  buildId: string,
  files: { rel: string; hash: string; size: number }[],
  manifest: Record<string, string>,
): Promise<boolean> {
  const builds = new BuildModel(getStore().db);
  const sha256 = manifestHash(manifest);
  const claim = await builds.claimManifest(buildId, sha256);
  if (claim === "duplicate") return false;
  if (claim === "conflict") {
    throw new HTTPException(409, { message: "This build already accepted a different manifest" });
  }
  try {
    await recordUses(projectId, buildId, files);
    await getStore().storage.write(
      `${projectId}/builds/${buildId}/storybook/manifest.json`,
      Buffer.from(JSON.stringify(manifest)),
    );
    // The files are stored content-addressed: nothing to extract, so publishing is complete.
    await getStore().publish?.completer.complete(buildId, { ok: true });
  } catch (error) {
    await builds.releaseManifest(buildId, sha256);
    throw error;
  }
  return true;
}

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

/** Record the build's use of each stored blob; a blob a collector already claimed is a 409 to retry. */
async function recordUses(
  projectId: string,
  buildId: string,
  files: readonly { hash: string }[],
): Promise<void> {
  try {
    await recordContentUses(
      getStore().db,
      getStore().storage,
      { projectId, buildId },
      files.map((file) => file.hash),
    );
  } catch (error) {
    if (!(error instanceof ContentCollectingError)) throw error;
    throw new HTTPException(409, {
      message: "Some content was being collected: upload the missing files again and retry",
    });
  }
}

import { registerBuildCancel } from "./build-cancel.ts";
import { registerBuildChangeset } from "./build-changeset.ts";
import { registerBuildReviews } from "./build-reviews.ts";
import { registerBuildsInFlight } from "./builds-in-flight.ts";
import { registerComments } from "./comments.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import {
  badRequest,
  buildSchema,
  errorSchema,
  forbidden as forbiddenResponse,
  notFound as notFoundResponse,
  unauthorized,
} from "./schemas.ts";
import { registerSnapshots } from "./snapshots.ts";
/** Register the build list, upload, fetch, retry, and delete endpoints. */
export function registerBuilds(app: ShelfRouter): void {
  registerBuildsInFlight(app);
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
    if (build.status === "failed") {
      throw new HTTPException(409, {
        message: `Build ${build.id} failed; run storyshelf upload again to create a new build`,
      });
    }
    const maxBytes = getStore().config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    const zipBytes = await storeUploadStream(
      getStore().storage,
      storybookZipPath(project.id, build.id),
      c.req.raw.body,
      maxBytes,
    );
    const route = await planOrDiscard(zipBytes, project.id, build.id);
    const reqId = c.get("requestId");
    const published = await publishUpload(route, build, reqId);
    await getStore().enqueueCapture?.(build.id, reqId);
    return c.json(published, 202);
  });

  app.openapi(dedupRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    await buildForProject(project.id, buildId);
    const { hashes } = c.req.valid("json");
    const needed: string[] = [];
    for (const hash of hashes) {
      if (!(await getStore().storage.exists(contentKey(hash)))) {
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
      // Every file is checked before anything is written, so a bad one leaves no partial upload.
      const files = await verifiedUploads(await c.req.formData());
      for (const { hash, buffer } of files) {
        // oxlint-disable-next-line no-await-in-loop -- one write at a time keeps the order stable
        await getStore().storage.write(contentKey(hash), buffer);
      }
    } else {
      // Single content upload via PUT with hash header
      const hash = c.req.header("x-content-hash") ?? "";
      refuseInvalidHash(hash);
      const buffer = Buffer.from(await c.req.arrayBuffer());
      refuseMismatch(hash, buffer);
      await getStore().storage.write(contentKey(hash), buffer);
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
    const published = await publishManifest(project.id, build.id, files, manifest);
    if (published) await getStore().enqueueCapture?.(build.id, c.get("requestId"));
    return c.json({ ok: true }, 200);
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
    const updated = await new BuildModel(getStore().db).resetStatus(build.id, "pending");
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
  registerBuildCancel(app);
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
    422: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "The inline zip is invalid, unsafe, or exceeds the extraction limits. The build ends `failed`; upload again to create a new build.",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "The build already failed (for example a rejected zip); create a new build",
    },
    413: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "Upload exceeds the configured size limit, or the zip is over the inline limit and this host (serverless) runs no publish consumer: upload file by file instead (POST /dedup, PUT /content, POST /manifest)",
    },
    ...badRequest,
    ...forbiddenResponse,
    ...notFoundResponse,
  },
});

/** Answer 400 and log only the reason: the refused value is never logged or echoed. */
function refuseUpload(reason: string, message: string): never {
  getStore().logger.warn({ reason }, "content upload refused");
  throw new HTTPException(400, { message });
}

/** Answer 400 for a hash that is not a SHA-256 hex digest. */
function refuseInvalidHash(hash: string): void {
  if (!isContentHash(hash)) refuseUpload("invalid content hash", "Invalid content hash");
}

/**
 * The shared `content/<hash>` blob belongs to no project, so its bytes must be what its name says:
 * an upload whose SHA-256 differs from its hash is refused, or one project could plant bytes under
 * a hash another project's manifest names.
 */
function refuseMismatch(hash: string, buffer: Buffer): void {
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== hash)
    refuseUpload("content does not match its hash", "Content does not match its hash");
}

/** The files of a multipart content upload; each key is a valid hash and names its own bytes. */
async function verifiedUploads(form: FormData): Promise<{ hash: string; buffer: Buffer }[]> {
  return await Promise.all(
    [...form.entries()].map(async ([hash, value]) => {
      if (!(value instanceof File)) refuseUpload("not a file", "Only files can be uploaded");
      refuseInvalidHash(hash);
      const buffer = Buffer.from(await value.arrayBuffer());
      refuseMismatch(hash, buffer);
      return { hash, buffer };
    }),
  );
}

const contentHashSchema = z.string().regex(CONTENT_HASH_PATTERN, "Invalid content hash");
const dedupHashesSchema = z.object({ hashes: z.array(contentHashSchema) });
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

const manifestFileSchema = z.object({ rel: z.string(), hash: contentHashSchema, size: z.number() });
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
      description: "Manifest stored, or the same manifest was already accepted (no-op)",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "The build already accepted a different manifest",
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
