/* oxlint-disable max-lines -- route table + handlers colocated, split per-router */
import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";
import { HTTPException } from "hono/http-exception";

import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import { getStore } from "../store.ts";
import { BUILD_STATUSES, type ProjectRole } from "../types.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";
import {
  badRequest,
  buildSchema,
  commentCreateSchema,
  commentSchema,
  forbidden as forbiddenResponse,
  notFound as notFoundResponse,
  okSchema,
  snapshotSchema,
  unauthorized,
} from "./schemas.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const DEVELOPER_ROLES: readonly ProjectRole[] = ["developer", "approver", "admin"];
const APPROVER_ROLES: readonly ProjectRole[] = ["approver", "admin"];

const buildUploadSchema = z.object({
  gitSha: z.string(),
  gitBranch: z.string(),
  authorEmail: z.string().optional(),
  authorName: z.string().optional(),
  message: z.string().optional(),
  zip: z.instanceof(File).openapi({ type: "string", format: "binary" }).optional(),
}).openapi("BuildUpload");

const buildListQuery = z.object({
  status: z.enum(BUILD_STATUSES).optional(),
  branch: z.string().optional(),
});

async function buildForProject(projectId: string, buildId: string): Promise<import("../models/build.ts").Build> {
  const build = await new BuildModel(getStore().db).get(buildId);
  if (!build || build.projectId !== projectId) {
    notFound("Build not found");
  }
  return build;
}

async function snapshotForBuild(build: { id: string }, snapshotId: string): Promise<import("../models/snapshot.ts").Snapshot> {
  const snapshot = await new SnapshotModel(getStore().db).get(snapshotId);
  if (!snapshot || snapshot.buildId !== build.id) {
    notFound("Snapshot not found");
  }
  return snapshot;
}

async function refreshBuild(buildId: string): Promise<void> {
  const db = getStore().db;
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

async function approveSnapshot(snapshotId: string, userId: string): Promise<void> {
  const db = getStore().db;
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

const listBuildsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds",
  request: {
    params: z.object({ slug: z.string() }),
    query: buildListQuery,
  },
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

const listSnapshotsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: snapshotSchema.array() } }, description: "List snapshots for a build" },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const approveSnapshotRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots/{snapshotId}/approve",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), snapshotId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "Snapshot approved" },
    ...notFoundResponse,
  },
});

const rejectSnapshotRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots/{snapshotId}/reject",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), snapshotId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "Snapshot rejected" },
    ...notFoundResponse,
  },
});

const approveAllRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/approve-all",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "All snapshots approved" },
    ...notFoundResponse,
  },
});

const rejectAllRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/reject-all",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "All snapshots rejected" },
    ...notFoundResponse,
  },
});

const listCommentsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: commentSchema.array() } }, description: "List comments on a build" },
    ...notFoundResponse,
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
    ...notFoundResponse,
  },
});

const resolveCommentRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/comments/{commentId}/resolve",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), commentId: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: commentSchema } }, description: "Comment resolved" },
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

  app.openapi(listSnapshotsRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshots = new SnapshotModel(getStore().db).listByBuild(build.id);
    return c.json(await snapshots);
  });

  app.openapi(approveSnapshotRoute, async (c) => {
    const { slug, buildId, snapshotId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    await snapshotForBuild(build, snapshotId);
    const userId = getStore().user?.id ?? "anonymous";
    await approveSnapshot(snapshotId, userId);
    return c.json({ ok: true });
  });

  app.openapi(rejectSnapshotRoute, async (c) => {
    const { slug, buildId, snapshotId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshot = await snapshotForBuild(build, snapshotId);
    const userId = getStore().user?.id ?? "anonymous";
    await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", userId);
    await refreshBuild(build.id);
    return c.json({ ok: true });
  });

  app.openapi(approveAllRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
    const userId = getStore().user?.id ?? "anonymous";
    await Promise.all(
      snapshots
        .filter((snapshot) => snapshot.status === "new" || snapshot.status === "changed")
        .map(async (snapshot) => {
          await approveSnapshot(snapshot.id, userId);
        }),
    );
    return c.json({ ok: true });
  });

  app.openapi(rejectAllRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
    const userId = getStore().user?.id ?? "anonymous";
    await Promise.all(
      snapshots
        .filter((snapshot) => snapshot.status === "new" || snapshot.status === "changed")
        .map(async (snapshot) => {
          await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", userId);
        }),
    );
    await refreshBuild(build.id);
    return c.json({ ok: true });
  });

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
      notFound("Comment not found");
    }
    return c.json(comment);
  });
}

function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}