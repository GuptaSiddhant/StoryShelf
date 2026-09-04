import { z } from "@hono/zod-openapi";

import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import { getStore } from "../store.ts";
import { type ProjectRole, BUILD_STATUSES } from "../types.ts";
import { notFound } from "./helpers.ts";

/** Roles permitted to view builds, snapshots, and comments. */
export const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
/** Roles permitted to upload builds and write comments. */
export const DEVELOPER_ROLES: readonly ProjectRole[] = ["developer", "approver", "admin"];
/** Roles permitted to approve or reject snapshots and delete builds. */
export const APPROVER_ROLES: readonly ProjectRole[] = ["approver", "admin"];

/** Multipart input schema for uploading a build with its Storybook bundle. */
export const buildUploadSchema = z.object({
  gitSha: z.string(),
  gitBranch: z.string(),
  authorEmail: z.string().optional(),
  authorName: z.string().optional(),
  message: z.string().optional(),
  zip: z.instanceof(File).openapi({ type: "string", format: "binary" }).optional(),
}).openapi("BuildUpload");

/** Query filters accepted by the build list endpoint. */
export const buildListQuery = z.object({
  status: z.enum(BUILD_STATUSES).optional(),
  branch: z.string().optional(),
  labelKey: z.string().optional(),
  labelValue: z.string().optional(),
});

/** Fetch a build scoped to its project, throwing 404 when it does not belong. */
export async function buildForProject(projectId: string, buildId: string): Promise<import("../models/build.ts").Build> {
  const build = await new BuildModel(getStore().db).get(buildId);
  if (!build || build.projectId !== projectId) {
    notFound("Build not found");
  }
  return build;
}

/** Fetch a snapshot scoped to its build, throwing 404 when it does not belong. */
export async function snapshotForBuild(build: { id: string }, snapshotId: string): Promise<import("../models/snapshot.ts").Snapshot> {
  const snapshot = await new SnapshotModel(getStore().db).get(snapshotId);
  if (!snapshot || snapshot.buildId !== build.id) {
    notFound("Snapshot not found");
  }
  return snapshot;
}

/** Recompute a build's counts and roll its status up from its snapshots. */
export async function refreshBuild(buildId: string): Promise<void> {
  const {db} = getStore();
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
    await emitWebhookEvent(db, build.projectId, `build:${status}`, {
      buildId,
      status,
      snapshotCount: snapshots.length,
    });
  }
}

/** Approve a snapshot, promote its screenshot to baseline, and refresh the build. */
export async function approveSnapshot(snapshotId: string, userId: string): Promise<void> {
  const {db} = getStore();
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
  const baselines = new BaselineModel(db, getStore().storage);
  await baselines.upsert(project.id, snapshot.storyId, snapshot.viewportName, build.gitBranch, snapshot.id, snapshot.screenshotPath);
  await refreshBuild(build.id);
}

/** Extract a string from a multipart form field, ignoring file entries. */
function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export { asString };