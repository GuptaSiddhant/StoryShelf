import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { getStore } from "../store.ts";
import { BUILD_STATUSES, type BuildStatus, type ProjectRole } from "../types.ts";
import { storybookZipPath } from "../utils/paths.ts";
import {
  json,
  notFound,
  resolveAuthorizedProject,
  validJson,
} from "./helpers.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const DEVELOPER_ROLES: readonly ProjectRole[] = ["developer", "approver", "admin"];
const APPROVER_ROLES: readonly ProjectRole[] = ["approver", "admin"];

const commentSchema = z.object({
  body: z.string().min(1),
  snapshotId: z.string().optional(),
  parentId: z.string().optional(),
});

function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

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
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const statusParam = c.req.query("status");
    const status = BUILD_STATUSES.includes(statusParam as BuildStatus) ? (statusParam as BuildStatus) : undefined;
    const branch = c.req.query("branch");
    const builds = new BuildModel(getStore().db).list(project.id, { status, branch: branch ?? undefined });
    return json(c, await builds);
  });

  app.post("/api/v1/projects/:slug/builds", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...DEVELOPER_ROLES);
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

    const zip = form.get("zip");
    if (zip && typeof zip !== "string") {
      const buffer = Buffer.from(await zip.arrayBuffer());
      await getStore().storage.write(storybookZipPath(project.id, build.id), buffer);
    }

    const reqId = c.get("requestId") as string | undefined;
    await getStore().enqueueCapture?.(build.id, reqId);
    return json(c, build, 202);
  });

  app.get("/api/v1/projects/:slug/builds/:buildId", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    return json(c, build);
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/retry", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const updated = await new BuildModel(getStore().db).setStatus(build.id, "pending");
    return json(c, updated, 202);
  });

  app.delete("/api/v1/projects/:slug/builds/:buildId", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...APPROVER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    await new BuildModel(getStore().db).remove(build.id);
    return c.body(null, 204);
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/snapshots", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const snapshots = new SnapshotModel(getStore().db).listByBuild(build.id);
    return json(c, await snapshots);
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/approve", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...APPROVER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    await snapshotForBuild(build, c.req.param("snapshotId"));
    const userId = getStore().user?.id ?? "anonymous";
    await approveSnapshot(c.req.param("snapshotId"), userId);
    return json(c, { ok: true });
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/reject", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...APPROVER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const snapshot = await snapshotForBuild(build, c.req.param("snapshotId"));
    const userId = getStore().user?.id ?? "anonymous";
    await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", userId);
    await refreshBuild(build.id);
    return json(c, { ok: true });
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/approve-all", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...APPROVER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
    const userId = getStore().user?.id ?? "anonymous";
    await Promise.all(
      snapshots
        .filter((snapshot) => snapshot.status === "new" || snapshot.status === "changed")
        .map(async (snapshot) => {
          await approveSnapshot(snapshot.id, userId);
        }),
    );
    return json(c, { ok: true });
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/reject-all", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...APPROVER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
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
    return json(c, { ok: true });
  });

  app.get("/api/v1/projects/:slug/builds/:buildId/comments", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    return json(c, await new CommentModel(getStore().db).listByBuild(build.id));
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/comments", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const body = await validJson(c, commentSchema);
    const userId = getStore().user?.id ?? "anonymous";
    const comment = await new CommentModel(getStore().db).create(project.id, build.id, userId, body);
    return json(c, comment, 201);
  });

  app.post("/api/v1/projects/:slug/builds/:buildId/comments/:commentId/resolve", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const comment = await new CommentModel(getStore().db).resolve(c.req.param("commentId"));
    if (comment.buildId !== build.id) {
      notFound("Comment not found");
    }
    return json(c, comment);
  });
}