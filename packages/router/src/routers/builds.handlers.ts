import { z } from "@hono/zod-openapi";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { emitWebhookEvent } from "@storyshelf/core/adapter/webhook-events";
import { extractStorybookToScratch, persistStorybookStatics } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import { BaselineModel } from "@storyshelf/core/models";
import { BuildModel } from "@storyshelf/core/models";
import { LabelModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Build, Snapshot } from "@storyshelf/core/schema";
import { type ProjectRole, BUILD_STATUSES } from "@storyshelf/core/types";
import { HTTPException } from "hono/http-exception";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { getStore } from "../store.ts";
import { notFound } from "./helpers.ts";

/** Roles permitted to view builds, snapshots, and comments. */
export const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
/** Roles permitted to upload builds and write comments. */
export const DEVELOPER_ROLES: readonly ProjectRole[] = ["developer", "approver", "admin"];
/** Roles permitted to approve or reject snapshots and delete builds. */
export const APPROVER_ROLES: readonly ProjectRole[] = ["approver", "admin"];

/** JSON input schema for creating a build before streaming its bundle. */
export const buildCreateJsonSchema = z
  .object({
    gitSha: z.string().min(1),
    gitBranch: z.string().min(1),
    authorEmail: z.string().optional(),
    authorName: z.string().optional(),
    message: z.string().optional(),
    labels: z.array(z.object({ key: z.string().min(1), value: z.string() })).optional(),
  })
  .openapi("BuildCreate");

/** Metadata accepted by either build-creation route. */
export interface BuildCreateMetadata {
  gitSha: string;
  gitBranch: string;
  authorEmail?: string;
  authorName?: string;
  message?: string;
  labels?: { key: string; value: string }[];
}

/* oxlint-disable eslint/no-await-in-loop -- label attach is intentionally sequential */
async function attachLabels(
  db: DatabaseAdapter,
  projectId: string,
  buildId: string,
  labels: { key: string; value: string }[],
): Promise<void> {
  const models = new LabelModel(db);
  for (const { key, value } of labels) {
    const existing = await models.getType(projectId, key);
    if (!existing) {
      await models.createType(projectId, { key, name: key });
    }
    await models.attach(projectId, buildId, key, value);
  }
}
/* oxlint-enable eslint/no-await-in-loop */

/**
 * Create a build record with labels and the `build:created` webhook.
 * Shared by the build-creation route.
 */
export async function createBuildRecord(
  project: Project,
  meta: BuildCreateMetadata,
): Promise<Build> {
  const { db, config } = getStore();
  if (!meta.gitSha || !meta.gitBranch) {
    throw new HTTPException(400, { message: "gitSha and gitBranch are required" });
  }
  const build = await new BuildModel(db).create(project.id, {
    gitSha: meta.gitSha,
    gitBranch: meta.gitBranch,
    isDefault: meta.gitBranch === project.gitDefaultBranch,
    authorEmail: meta.authorEmail,
    authorName: meta.authorName,
    message: meta.message,
  });
  if (meta.labels && meta.labels.length > 0) {
    await attachLabels(db, project.id, build.id, meta.labels);
  }
  await emitWebhookEvent(
    db,
    project.id,
    "build:created",
    {
      buildId: build.id,
      gitSha: meta.gitSha,
      gitBranch: meta.gitBranch,
      authorEmail: meta.authorEmail,
      authorName: meta.authorName,
      message: meta.message,
    },
    config.secret,
  );
  return build;
}

/**
 * Stream a raw request body into storage with a byte cap.
 * Throws 400 for a missing body, 413 once `maxBytes` is exceeded.
 */
export async function storeUploadStream(
  storage: StorageAdapter,
  path: string,
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<void> {
  if (!body) {
    throw new HTTPException(400, { message: "Missing request body" });
  }
  let seen = 0;
  const limiter = new Transform({
    transform(
      chunk: Buffer,
      _encoding: string,
      callback: (error?: Error | null, data?: Buffer) => void,
    ): void {
      seen += chunk.length;
      if (seen > maxBytes) {
        callback(new Error(`Upload exceeds ${maxBytes} byte limit`));
      } else {
        callback(null, chunk);
      }
    },
  });
  try {
    const nodeBody = Readable.fromWeb(body as unknown as NodeWebStream);
    await storage.writeStream(path, nodeBody.pipe(limiter));
  } catch (error) {
    if (seen > maxBytes) {
      throw new HTTPException(413, { message: "Upload exceeds size limit" });
    }
    throw error;
  }
}

/** Parse a Content-Length header value into bytes, or undefined when unknown. */
function parseContentLength(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Best-effort inline statics extraction for small uploads (see
 * `maxInlineUnzipSize`). Never throws: failures are logged and the capture
 * job backfills the same keys idempotently.
 */
export async function persistInlineStatics(
  storage: StorageAdapter,
  scratchDir: string | undefined,
  maxInlineBytes: number | undefined,
  contentLength: string | undefined,
  projectId: string,
  buildId: string,
  logger: Logger,
): Promise<void> {
  if (!scratchDir || !maxInlineBytes) {
    return;
  }
  const size = parseContentLength(contentLength);
  if (size === undefined || size > maxInlineBytes) {
    return;
  }
  try {
    const extractedDir = await extractStorybookToScratch(storage, scratchDir, projectId, buildId);
    await persistStorybookStatics(storage, extractedDir, projectId, buildId);
    logger.info({ buildId, size }, "upload statics persisted inline");
  } catch (error) {
    logger.error({ err: error, buildId }, "inline statics persist failed; capture will backfill");
  }
}
/** Query filters accepted by the build list endpoint. */
export const buildListQuery = z.object({
  status: z.enum(BUILD_STATUSES).optional(),
  branch: z.string().optional(),
  labelKey: z.string().optional(),
  labelValue: z.string().optional(),
});

/** Fetch a build scoped to its project, throwing 404 when it does not belong. */
export async function buildForProject(projectId: string, buildId: string): Promise<Build> {
  const build = await new BuildModel(getStore().db).get(buildId);
  if (!build || build.projectId !== projectId) {
    notFound("Build not found");
  }
  return build;
}

/** Fetch a snapshot scoped to its build, throwing 404 when it does not belong. */
export async function snapshotForBuild(
  build: { id: string },
  snapshotId: string,
): Promise<Snapshot> {
  const snapshot = await new SnapshotModel(getStore().db).get(snapshotId);
  if (!snapshot || snapshot.buildId !== build.id) {
    notFound("Snapshot not found");
  }
  return snapshot;
}

/** Recompute a build's counts and roll its status up from its snapshots. */
export async function refreshBuild(buildId: string): Promise<void> {
  const { db, config } = getStore();
  await new BuildModel(db).updateCounts(buildId);
  const snapshots = await new SnapshotModel(db).listByBuild(buildId);
  const unresolved = snapshots.some((s) => s.status === "new" || s.status === "changed");
  let status: "reviewing" | "rejected" | "approved";
  if (unresolved) {
    status = "reviewing";
  } else {
    const rejected = snapshots.some((s) => s.status === "rejected");
    status = rejected ? "rejected" : "approved";
  }
  const build = await new BuildModel(db).get(buildId);
  if (build) {
    await new BuildModel(db).setStatus(buildId, status);
    await emitWebhookEvent(
      db,
      build.projectId,
      `build:${status}`,
      {
        buildId,
        status,
        snapshotCount: snapshots.length,
      },
      config.secret,
    );
  }
}

/** Approve a snapshot, promote its screenshot to baseline, and refresh the build. */
export async function approveSnapshot(snapshotId: string, userId: string | null): Promise<void> {
  const { db, config } = getStore();
  const snapshots = new SnapshotModel(db);
  const snapshot = await snapshots.get(snapshotId);
  if (!snapshot) {
    notFound("Snapshot not found");
  }
  const project = await new ProjectModel(db).get(snapshot.projectId);
  const build = await new BuildModel(db).get(snapshot.buildId);
  if (!project || !build) {
    notFound("Project or build not found");
  }
  await snapshots.review(snapshotId, "approved", userId);
  const baselines = new BaselineModel(db, getStore().storage, config.secret);
  await baselines.upsert(
    project.id,
    snapshot.storyId,
    snapshot.viewportName,
    build.gitBranch,
    snapshot.id,
    snapshot.screenshotPath,
  );
  await refreshBuild(build.id);
}
