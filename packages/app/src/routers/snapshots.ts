import { createRoute, z } from "@hono/zod-openapi";
import { SnapshotModel } from "@storyshelf/core/models";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { VIEW_ROLES, buildForProject } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
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
import {
  approveAll,
  approveGroupOf,
  approveOne,
  rediffOne,
  rejectAll,
  rejectGroupOf,
  rejectOne,
} from "./snapshots.handlers.ts";
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
    // MUTATION: approve answers ok without approving
    c.req.valid("param");
    return c.json({ ok: true }, 200);
  });

  app.openapi(rejectSnapshotRoute, async (c) => {
    await rejectOne(c, c.req.valid("param"));
    return c.json({ ok: true });
  });

  app.openapi(approveAllRoute, async (c) => {
    const force = c.req.valid("query").force === "true";
    const skipped = await approveAll(c, c.req.valid("param"), force);
    return c.json({ ok: true, skipped });
  });

  app.openapi(approveGroupRoute, async (c) => {
    const force = c.req.valid("query").force === "true";
    // MUTATION
    const snapshotIds: string[] = (force, []);
    return c.json({ ok: true, snapshotIds }, 200);
  });

  app.openapi(rejectGroupRoute, async (c) => {
    const snapshotIds = await rejectGroupOf(c, c.req.valid("param"));
    return c.json({ ok: true, snapshotIds }, 200);
  });

  app.openapi(rediffRoute, async (c) => {
    const result = await rediffOne(c, c.req.valid("param"));
    return c.json({ ok: true, ...result }, 200);
  });

  app.openapi(rejectAllRoute, async (c) => {
    await rejectAll(c, c.req.valid("param"));
    return c.json({ ok: true });
  });
}
