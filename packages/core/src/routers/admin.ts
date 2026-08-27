import type { Hono } from "hono";
import { z } from "zod";

import { ProjectModel } from "../models/project.ts";
import { Retention } from "../retention/purge.ts";
import { getStore } from "../store.ts";
import { json, requireSiteAdmin, validJson } from "./helpers.ts";

const purgeSchema = z.object({ ttlDays: z.number().optional() });

export function registerAdmin(app: Hono): void {
  app.post("/api/v1/admin/purge", async (c) => {
    requireSiteAdmin();
    const body = await validJson(c, purgeSchema);
    const ttlDays = body.ttlDays ?? getStore().config.purgeTtlDays ?? 30;
    const projects = await new ProjectModel(getStore().db).list();
    const retention = new Retention(getStore().db, getStore().storage);
    const results = await Promise.all(
      projects.map(async (project) => {
        return await retention.purge(project, { ttlDays, keepLatestPerBranch: true });
      }),
    );
    const removedBuilds = results.reduce((sum, result) => sum + result.removedBuilds, 0);
    return json(c, { removedBuilds });
  });
}
