import { createRoute, z } from "@hono/zod-openapi";
import { REDIFFABLE_BUILD_STATUSES, rediffBuild } from "@storyshelf/core/capture";
import { SnapshotModel } from "@storyshelf/core/models";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { findDriftedSnapshots, isBaselineChanged, isOpenSnapshot } from "./baseline-guard.ts";
import {
  VIEW_ROLES,
  APPROVER_ROLES,
  snapshotForBuild,
  refreshBuild,
  approveSnapshot,
  buildForProject,
} from "./builds.handlers.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRefresh, isHxRequest } from "./htmx.ts";
import { hxAdvance } from "./review-next.ts";
import {
  snapshotSchema,
  okSchema,
  approveAllResultSchema,
  groupDecisionResultSchema,
  rediffResultSchema,
  baselineChangedSchema,
  errorSchema,
  notFound,
  unauthorized,
} from "./schemas.ts";
import { approveGroup, rejectGroup, splitByDrift } from "./snapshot-groups.ts";
const listSnapshotsRoute = createRoute({
  method: "get",
  tags: ["Review"],
  summary: "List snapshots",
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
  tags: ["Review"],
  summary: "Approve a snapshot",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots/{snapshotId}/approve",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string(), snapshotId: z.string() }),
    query: z.object({ force: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Snapshot approved",
    },
    409: {
      content: { "application/json": { schema: baselineChangedSchema } },
      description:
        "The baseline changed after this diff was computed; re-diff the build or pass force=true",
    },
    ...notFound,
  },
});

const rejectSnapshotRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Reject a snapshot",
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
  tags: ["Review"],
  summary: "Approve all open snapshots",
  path: "/api/v1/projects/{slug}/builds/{buildId}/approve-all",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string() }),
    query: z.object({ force: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: approveAllResultSchema } },
      description: "Open snapshots approved; snapshots with a changed baseline are skipped",
    },
    ...notFound,
  },
});

const groupParams = z.object({
  slug: z.string(),
  buildId: z.string(),
  storyId: z.string(),
  modeKey: z.string(),
});

const approveGroupRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Approve a story/mode across all browsers",
  path: "/api/v1/projects/{slug}/builds/{buildId}/stories/{storyId}/modes/{modeKey}/approve",
  request: {
    params: groupParams,
    query: z.object({ force: z.enum(["true", "false"]).optional() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: groupDecisionResultSchema } },
      description:
        "Every open snapshot of the story and mode approved and each engine's baseline promoted",
    },
    409: {
      content: { "application/json": { schema: baselineChangedSchema } },
      description:
        "A member's baseline changed after its diff; nothing was approved. Re-diff or pass force=true",
    },
    ...notFound,
  },
});

const rejectGroupRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Reject a story/mode across all browsers",
  path: "/api/v1/projects/{slug}/builds/{buildId}/stories/{storyId}/modes/{modeKey}/reject",
  request: { params: groupParams },
  responses: {
    200: {
      content: { "application/json": { schema: groupDecisionResultSchema } },
      description: "Every open snapshot of the story and mode rejected",
    },
    ...notFound,
  },
});

const rediffRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Re-diff against current baselines",
  path: "/api/v1/projects/{slug}/builds/{buildId}/rediff",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: rediffResultSchema } },
      description:
        "Undecided snapshots re-diffed against the current baselines (no re-render). Decided snapshots are untouched.",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Default-branch builds are authoritative and are not re-diffed",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "Build has not finished capturing or failed; retry capture instead",
    },
    ...notFound,
  },
});

const rejectAllRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Reject all open snapshots",
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
export function registerSnapshots(app: ShelfRouter): void {
  app.openapi(listSnapshotsRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshots = new SnapshotModel(getStore().db).listByBuild(build.id);
    return c.json(await snapshots);
  });

  app.openapi(approveSnapshotRoute, async (c) => {
    const { slug, buildId, snapshotId } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    await snapshotForBuild(build, snapshotId);
    const userId = getStore().user?.id ?? null;
    try {
      await approveSnapshot(snapshotId, userId, { force: force === "true" });
    } catch (error) {
      if (!isHxRequest(c) || !isBaselineChanged(error)) {
        throw error;
      }
      // The review page recomputes staleness on load and offers re-diff / approve anyway.
      c.header("HX-Redirect", `/projects/${slug}/builds/${buildId}/diff?snapshot=${snapshotId}`);
      return c.json({ ok: true }, 200);
    }
    await hxAdvance(c, { slug, buildId, snapshotId });
    return c.json({ ok: true }, 200);
  });

  app.openapi(rejectSnapshotRoute, async (c) => {
    const { slug, buildId, snapshotId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshot = await snapshotForBuild(build, snapshotId);
    const userId = getStore().user?.id ?? null;
    await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", userId);
    await refreshBuild(build.id);
    await hxAdvance(c, { slug, buildId, snapshotId });
    return c.json({ ok: true });
  });

  app.openapi(approveAllRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
    const userId = getStore().user?.id ?? null;
    const forced = force === "true";
    const drifted = forced ? new Map() : await findDriftedSnapshots(project, build, snapshots);
    // A story/mode is approved on every engine or on none: one drifted member skips its group.
    const { approvable, skipped } = splitByDrift(
      snapshots.filter((snapshot) => isOpenSnapshot(snapshot)),
      drifted,
    );
    await Promise.all(
      approvable.map(async (snapshot) => {
        await approveSnapshot(snapshot.id, userId, { force: forced, deferRefresh: true });
      }),
    );
    await refreshBuild(build.id);
    hxRefresh(c);
    return c.json({ ok: true, skipped: skipped.map((snapshot) => snapshot.id) });
  });

  app.openapi(approveGroupRoute, async (c) => {
    const { slug, buildId, storyId, modeKey } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const userId = getStore().user?.id ?? null;
    let snapshotIds: string[];
    try {
      snapshotIds = await approveGroup(project, build, { storyId, modeKey }, userId, {
        force: force === "true",
      });
    } catch (error) {
      if (!isHxRequest(c) || !isBaselineChanged(error)) {
        throw error;
      }
      c.header("HX-Redirect", `/projects/${slug}/builds/${buildId}/diff`);
      return c.json({ ok: true, snapshotIds: [] }, 200);
    }
    const first = snapshotIds[0];
    if (first) await hxAdvance(c, { slug, buildId, snapshotId: first });
    return c.json({ ok: true, snapshotIds }, 200);
  });

  app.openapi(rejectGroupRoute, async (c) => {
    const { slug, buildId, storyId, modeKey } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const userId = getStore().user?.id ?? null;
    const snapshotIds = await rejectGroup(build, { storyId, modeKey }, userId);
    const first = snapshotIds[0];
    if (first) await hxAdvance(c, { slug, buildId, snapshotId: first });
    return c.json({ ok: true, snapshotIds }, 200);
  });

  app.openapi(rediffRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    if (build.isDefault) {
      throw new HTTPException(400, { message: "Default-branch builds are not re-diffed" });
    }
    if (!REDIFFABLE_BUILD_STATUSES.has(build.status)) {
      throw new HTTPException(409, {
        message: `Build is ${build.status}; wait for capture to finish or retry capture`,
      });
    }
    const { db, storage, logger } = getStore();
    const result = await rediffBuild({ db, storage, logger }, project, build);
    await refreshBuild(build.id);
    hxRefresh(c);
    flashHx(c, "Re-diffed against current baselines");
    return c.json({ ok: true, ...result }, 200);
  });

  app.openapi(rejectAllRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
    const userId = getStore().user?.id ?? null;
    await Promise.all(
      snapshots
        .filter((snapshot) => snapshot.status === "new" || snapshot.status === "changed")
        .map(async (snapshot) => {
          await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", userId);
        }),
    );
    await refreshBuild(build.id);
    hxRefresh(c);
    return c.json({ ok: true });
  });
}
