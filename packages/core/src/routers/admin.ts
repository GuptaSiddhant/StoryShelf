import type { Hono } from "hono";
import { z } from "zod";

import { ProjectModel } from "../models/project.ts";
import { Retention } from "../retention/purge.ts";
import { getStore } from "../store.ts";
import { json, validJson } from "./helpers.ts";

const purgeSchema = z.object({ ttlDays: z.number().optional() });

export function registerAdmin(app: Hono): void {
  app.post("/api/v1/admin/purge", async (c) => {
    const body = await validJson(c, purgeSchema);
    const ttlDays = body.ttlDays ?? getStore().config.purgeTtlDays ?? 30;
    const projects = await new ProjectModel(getStore().db).list();
    const retention = new Retention(getStore().db, getStore().storage);
    let removedBuilds = 0;
    for (const project of projects) {
      const result = await retention.purge(project, { ttlDays, keepLatestPerBranch: true });
      removedBuilds += result.removedBuilds;
    }
    return json(c, { removedBuilds });
  });
}
