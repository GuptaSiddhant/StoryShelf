/* oxlint-disable typescript/promise-function-async -- admin helpers are async by design */
import { createRoute } from "@hono/zod-openapi";
import { ProjectModel } from "@storyshelf/core/models";
import { Retention } from "@storyshelf/core/retention";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { requireSiteAdmin } from "./helpers.ts";
import { forbidden as forbiddenResponse, purgeInputSchema, purgeSchema } from "./schemas.ts";
const purgeRoute = createRoute({
  method: "post",
  path: "/api/v1/admin/purge",
  request: { body: { content: { "application/json": { schema: purgeInputSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: purgeSchema } },
      description: "Retention purge run",
    },
    ...forbiddenResponse,
  },
});

/** Register the site-admin retention purge endpoint. */
export function registerAdmin(app: ShelfRouter): void {
  app.openapi(purgeRoute, async (c) => {
    requireSiteAdmin(c);
    const body = c.req.valid("json");
    const ttlDays = body.ttlDays ?? getStore().config.purgeTtlDays ?? 30;
    const removedBuilds = await purgeBuilds(ttlDays);
    const branch = await purgeBranches();
    return c.json({
      removedBuilds,
      removedBranches: branch.removedBranches,
      removedBaselines: branch.removedBaselines,
    });
  });
}

// oxlint-disable-next-line typescript/promise-function-async
async function purgeBuilds(ttlDays: number): Promise<number> {
  const projects = await new ProjectModel(getStore().db).list();
  const retention = new Retention(
    getStore().db,
    getStore().storage,
    {
      builds: getStore().db.tables.builds,
      buildLabels: getStore().db.tables.buildLabels,
      baselines: getStore().db.tables.baselines,
    },
    getStore().logger,
  );
  const results = await Promise.all(
    projects.map((project) => retention.purge(project, { ttlDays, keepLatestPerBranch: true })),
  );
  return results.reduce((sum, result) => sum + result.removedBuilds, 0);
}

// oxlint-disable-next-line typescript/promise-function-async
async function purgeBranches(): Promise<{ removedBranches: number; removedBaselines: number }> {
  const branchTtl = getStore().config.branchTtlDays ?? 30;
  if (branchTtl === null) {
    return { removedBranches: 0, removedBaselines: 0 };
  }
  const projects = await new ProjectModel(getStore().db).list();
  const retention = new Retention(
    getStore().db,
    getStore().storage,
    {
      builds: getStore().db.tables.builds,
      buildLabels: getStore().db.tables.buildLabels,
      baselines: getStore().db.tables.baselines,
    },
    getStore().logger,
  );
  const results = await Promise.all(
    projects.map((project) => retention.purgeStaleBranches(project, branchTtl)),
  );
  const removedBranches = results.reduce(
    (sum: number, r: { removedBranches: number }) => sum + r.removedBranches,
    0,
  );
  const removedBaselines = results.reduce(
    (sum: number, r: { removedBaselines: number }) => sum + r.removedBaselines,
    0,
  );
  return { removedBranches, removedBaselines };
}
