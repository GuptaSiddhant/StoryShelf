import type { Hono } from "hono";
import { z } from "zod";

import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { getStore } from "../store.ts";
import { BUILD_STATUSES, type BuildStatus } from "../types.ts";
import { findProjectBySlug, json, notFound, validJson } from "./helpers.ts";

const createSchema = z.object({
  gitSha: z.string().min(1),
  gitBranch: z.string().min(1),
  authorEmail: z.string().optional(),
  authorName: z.string().optional(),
  message: z.string().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1),
  snapshotId: z.string().optional(),
  parentId: z.string().optional(),
});

async function refreshBuild(buildId: string): Promise<void> {
  const db = getStore().db;
  await new BuildModel(db).updateCounts(buildId);
  const snapshots = await new SnapshotModel(db).listByBuild(buildId);
  const unresolved = snapshots.some((s) => s.status === "new" || s.status === "changed");
  if (unresolved) {
    await new BuildModel(db).setStatus(buildId, "reviewing");
  } else {
    const rejected = snapshots.some((s) => s.status === "rejected");
    await new BuildModel(db).setStatus(buildId, rejected ? "rejected" : "approved");
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

export function registerBuilds(app: Hono): void {
  app.get("/api/v1/projects/:slug/builds", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const statusParam = c.req.query("status");
    const status = BUILD_STATUSES.includes(statusParam as BuildStatus) ? (statusParam as BuildStatus) : undefined;
    const branch = c.req.query("branch");
    const builds = new BuildModel(getStore().db).list(project.id, { status, branch: branch ?? undefined });
    return json(c, await builds);
  });

  app.post("/api/v1/projects/:slug/builds", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const body = await validJson(c, createSchema);
    const build = await new BuildModel(getStore().db).create(project.id, {
      ...body,
      isDefault: body.gitBranch === project.gitDefaultBranch,
    });
    return json(c, build, 202);
  });

  app.get("/api/v1/projects/:slug/builds/:buildId", async (c) => {
    const build = await new BuildModel(getStore().db).get(c.req.param("buildId"));
    if (!build) {
      notFound("Build not found");
    }
    return json(c, build);
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/retry", async (c) => {
    const build = await new BuildModel(getStore().db).get(c.req.param("buildId"));
    if (!build) {
      notFound("Build not found");
    }
    const updated = await new BuildModel(getStore().db).setStatus(build.id, "pending");
    return json(c, updated, 202);
  });

  app.delete("/api/v1/projects/:slug/builds/:buildId", async (c) => {
    const build = await new BuildModel(getStore().db).get(c.req.param("buildId"));
    if (!build) {
      notFound("Build not found");
    }
    await new BuildModel(getStore().db).remove(build.id);
    return c.body(null, 204);
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots", async (c) => {
    const snapshots = new SnapshotModel(getStore().db).listByBuild(c.req.param("buildId"));
    return json(c, await snapshots);
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/approve", async (c) => {
    const userId = getStore().user?.id ?? "anonymous";
    await approveSnapshot(c.req.param("snapshotId"), userId);
    return json(c, { ok: true });
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/reject", async (c) => {
    const snapshot = await new SnapshotModel(getStore().db).get(c.req.param("snapshotId"));
    if (!snapshot) {
      notFound("Snapshot not found");
    }
    const userId = getStore().user?.id ?? "anonymous";
    await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", userId);
    await refreshBuild(snapshot.buildId);
    return json(c, { ok: true });
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/approve-all", async (c) => {
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(c.req.param("buildId"));
    const userId = getStore().user?.id ?? "anonymous";
    for (const snapshot of snapshots) {
      if (snapshot.status === "new" || snapshot.status === "changed") {
        await approveSnapshot(snapshot.id, userId);
      }
    }
    return json(c, { ok: true });
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/reject-all", async (c) => {
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(c.req.param("buildId"));
    const userId = getStore().user?.id ?? "anonymous";
    for (const snapshot of snapshots) {
      if (snapshot.status === "new" || snapshot.status === "changed") {
        await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", userId);
      }
    }
    await refreshBuild(c.req.param("buildId"));
    return json(c, { ok: true });
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/comments", async (c) => {
    return json(c, await new CommentModel(getStore().db).listByBuild(c.req.param("buildId")));
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/comments", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const body = await validJson(c, commentSchema);
    const userId = getStore().user?.id ?? "anonymous";
    const comment = await new CommentModel(getStore().db).create(project.id, c.req.param("buildId"), userId, body);
    return json(c, comment, 201);
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/comments/:commentId/resolve", async (c) => {
    const comment = await new CommentModel(getStore().db).resolve(c.req.param("commentId"));
    return json(c, comment);
  });
}
