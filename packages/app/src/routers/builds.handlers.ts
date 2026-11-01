import { z } from "@hono/zod-openapi";
import {
  ReferenceGenerationConflict,
  type DatabaseAdapter,
} from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { emitWebhookEvent } from "@storyshelf/core/adapter/webhook-events";
import {
  BaselineApprovalConflict,
  BaselineModel,
  BaselineWriteConflict,
} from "@storyshelf/core/models";
import { BuildModel } from "@storyshelf/core/models";
import { LabelModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Build, Snapshot } from "@storyshelf/core/schema";
import { type BuildStatus, type ProjectRole, BUILD_STATUSES } from "@storyshelf/core/types";
import { HTTPException } from "hono/http-exception";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { credentialKeys } from "../credential-keys.ts";
import { requestBuildState } from "../git-status.ts";
import { notifyProject } from "../notify.ts";
import { getStore } from "../store.ts";
import { assertBaselineCurrent, baselineChanged } from "./baseline-guard.ts";
import { notFound } from "./helpers.ts";
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
    throw new HTTPException(400, {
      message: "gitSha and gitBranch are required (revision SHA and baseline namespace)",
    });
  }
  const build = await new BuildModel(db).create(project.id, {
    gitSha: meta.gitSha,
    gitBranch: meta.gitBranch,
    isDefault: meta.gitBranch === project.gitDefaultBranch,
    authorEmail: meta.authorEmail,
    authorName: meta.authorName,
    message: meta.message,
    affectedOnly: meta.affectedOnly,
    baselineSha: await resolveBaselineSha(db, project.id, meta.gitBranch, meta.gitSha),
  });
  if (meta.labels && meta.labels.length > 0) {
    await attachLabels(db, project.id, build.id, meta.labels);
  }
  await emitWebhookEvent(
    db,
    { webhooks: getStore().db.tables.webhooks },
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
    credentialKeys(config),
  );
  await notifyProject(
    project,
    "build:created",
    {
      buildId: build.id,
      gitSha: meta.gitSha,
      gitBranch: meta.gitBranch,
      authorEmail: meta.authorEmail,
      authorName: meta.authorName,
      message: meta.message,
    },
    `/builds/${build.id}`,
  );
  await requestBuildState(build.id);
  return build;
}

/**
 * Stream a raw request body into storage with a byte cap, counting the bytes as they pass (a
 * chunked upload has no `Content-Length`). Resolves to the bytes stored.
 * Throws 400 for a missing body, 413 once `maxBytes` is exceeded.
 */
export async function storeUploadStream(
  storage: StorageAdapter,
  path: string,
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<number> {
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
    return seen;
  } catch (error) {
    if (seen > maxBytes) {
      throw new HTTPException(413, { message: "Upload exceeds size limit" });
    }
    throw error;
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

/** Roll snapshot statuses up into the build's review status. */
function rollupStatus(snapshots: Snapshot[]): "reviewing" | "rejected" | "approved" {
  if (snapshots.some((s) => s.status === "new" || s.status === "changed")) {
    return "reviewing";
  }
  return snapshots.some((s) => s.status === "rejected") ? "rejected" : "approved";
}

/** Recompute a build's counts and roll its status up from its snapshots. */
export async function refreshBuild(buildId: string): Promise<void> {
  const { db } = getStore();
  await new BuildModel(db).updateCounts(buildId);
  const snapshots = await new SnapshotModel(db).listByBuild(buildId);
  const status = rollupStatus(snapshots);
  const build = await new BuildModel(db).get(buildId);
  // A cancelled build is terminal: its snapshots may still be touched, but no verdict is announced.
  if (!build || build.status === "cancelled") return;
  await new BuildModel(db).setStatus(buildId, status);
  await announceBuildStatus(buildId, status, { snapshotCount: snapshots.length });
}

/**
 * Tell the world a build reached `status`: its git channels, the `build:<status>` webhook and the
 * project's notification channels. Every route that moves a build to a decided status ends here.
 */
export async function announceBuildStatus(
  buildId: string,
  status: BuildStatus,
  extra: { snapshotCount?: number } = {},
): Promise<void> {
  const { db, config } = getStore();
  const build = await new BuildModel(db).get(buildId);
  if (!build) return;
  await requestBuildState(buildId);
  const payload = { buildId, status, ...extra };
  await emitWebhookEvent(
    db,
    { webhooks: getStore().db.tables.webhooks },
    build.projectId,
    `build:${status}`,
    payload,
    credentialKeys(config),
  );
  const project = await new ProjectModel(db).get(build.projectId);
  if (!project) return;
  await notifyProject(project, `build:${status}`, payload, `/builds/${buildId}`);
}

/**
 * Approve a snapshot, promote its screenshot to baseline, and refresh the build.
 * Refuses with 409 when the baseline changed since the diff, unless `force` is set.
 * Bulk callers pass `deferRefresh` and call {@link refreshBuild} once, so the build's
 * outcome (and its git status) is announced a single time.
 */
export async function approveSnapshot(
  snapshotId: string,
  userId: string | null,
  options: { force?: boolean; deferRefresh?: boolean } = {},
): Promise<void> {
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
  if (build.status === "cancelled") {
    throw new HTTPException(409, { message: "The build was cancelled; retry it to review it" });
  }
  await assertBaselineCurrent(project, build, snapshot, options.force ?? false);
  if (!db.buildReferenceLifecycle) await snapshots.review(snapshotId, "approved", userId);
  const baselines = new BaselineModel(db, undefined, getStore().storage, credentialKeys(config));
  const prior = await baselines.getFor(
    project.id,
    snapshot.storyId,
    snapshot.viewportName,
    build.gitBranch,
    snapshot.browser,
  );
  try {
    await baselines.upsert(
      project.id,
      snapshot.storyId,
      snapshot.viewportName,
      build.gitBranch,
      snapshot.id,
      snapshot.screenshotPath,
      undefined,
      {
        browser: snapshot.browser,
        mode: snapshot.mode,
        approval: db.buildReferenceLifecycle
          ? { snapshot, reviewedBy: userId, force: options.force ?? false, branch: build.gitBranch }
          : undefined,
      },
    );
  } catch (error) {
    if (error instanceof BaselineWriteConflict || error instanceof ReferenceGenerationConflict) {
      if (error instanceof BaselineApprovalConflict && error.driftStatus)
        throw baselineChanged(snapshot.id, error.driftStatus);
      throw new HTTPException(409, { message: error.message });
    }
    throw error;
  }
  await notifyProject(
    project,
    prior ? "baseline:updated" : "baseline:created",
    {
      storyId: snapshot.storyId,
      viewport: snapshot.viewportName,
      browser: snapshot.browser ?? "chromium",
      branch: build.gitBranch,
      snapshotId: snapshot.id,
      buildId: build.id,
    },
    `/builds/${build.id}`,
  );
  if (!options.deferRefresh) {
    await refreshBuild(build.id);
  }
}

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
    affectedOnly: z.boolean().optional(),
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
  affectedOnly?: boolean;
  labels?: { key: string; value: string }[];
}

/** Latest prior revision on a branch with a build, or null for first builds. */
async function resolveBaselineSha(
  db: DatabaseAdapter,
  projectId: string,
  branch: string,
  sha: string,
): Promise<string | null> {
  const builds = await new BuildModel(db).list(projectId, { branch });
  return builds.find((build) => build.gitSha !== sha)?.gitSha ?? null;
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
