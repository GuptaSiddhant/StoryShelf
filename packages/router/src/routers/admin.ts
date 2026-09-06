import { createRoute } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";
import { ProjectModel } from "../models/project.ts";
import { Retention } from "../retention/purge.ts";
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
export function registerAdmin(app: ShelfApp): void {
  app.openapi(purgeRoute, async (c) => {
    requireSiteAdmin();
    const body = c.req.valid("json");
    const ttlDays = body.ttlDays ?? getStore().config.purgeTtlDays ?? 30;
    const projects = await new ProjectModel(getStore().db).list();
    const retention = new Retention(getStore().db, getStore().storage);
    const results = await Promise.all(
      projects.map(async (project) => {
        return await retention.purge(project, { ttlDays, keepLatestPerBranch: true });
      }),
    );
    const removedBuilds = results.reduce((sum, result) => sum + result.removedBuilds, 0);
    return c.json({ removedBuilds });
  });
}
