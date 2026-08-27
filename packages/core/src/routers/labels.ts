import type { Hono } from "hono";
import { z } from "zod";

import { LabelModel } from "../models/label.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { json, resolveAuthorizedProject, validJson } from "./helpers.ts";

const createSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  linkTemplate: z.string().optional(),
  color: z.string().optional(),
});

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

export function registerLabels(app: Hono): void {
  app.get("/api/v1/projects/:slug/label-types", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    return json(c, await new LabelModel(getStore().db).listTypes(project.id));
  });

  app.post("/api/v1/projects/:slug/label-types", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const body = await validJson(c, createSchema);
    return json(c, await new LabelModel(getStore().db).createType(project.id, body), 201);
  });

  app.delete("/api/v1/projects/:slug/label-types/:key", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    await new LabelModel(getStore().db).removeType(project.id, c.req.param("key"));
    return c.body(null, 204);
  });
}
