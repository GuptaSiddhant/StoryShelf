import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";
import { SnapshotModel } from "../models/snapshot.ts";
import { getStore } from "../store.ts";
import {
  VIEW_ROLES,
  APPROVER_ROLES,
  snapshotForBuild,
  refreshBuild,
  approveSnapshot,
  buildForProject,
} from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { snapshotSchema, okSchema, notFound, unauthorized } from "./schemas.ts";

const listSnapshotsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: snapshotSchema.array() } },
      description: "List snapshots for a build",
    },
    ...notFound,
    ...unauthorized,
  },
});

const approveSnapshotRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots/{snapshotId}/approve",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), snapshotId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Snapshot approved",
    },
    ...notFound,
  },
});

const rejectSnapshotRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots/{snapshotId}/reject",
  request: { params: z.object({ slug: z.string(), buildId: z.string(), snapshotId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Snapshot rejected",
    },
    ...notFound,
  },
});

const approveAllRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/approve-all",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "All snapshots approved",
    },
    ...notFound,
  },
});

const rejectAllRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/builds/{buildId}/reject-all",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "All snapshots rejected",
    },
    ...notFound,
  },
});

/** Register the snapshot list, approve, reject, and bulk-review endpoints. */
export function registerSnapshots(app: ShelfApp): void {
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
}
