import type { Hono } from "hono";
import { z } from "zod";

import { LabelModel } from "../models/label.ts";
import { getStore } from "../store.ts";
import { findProjectBySlug, json, notFound, validJson } from "./helpers.ts";

const createSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  linkTemplate: z.string().optional(),
  color: z.string().optional(),
});

export function registerLabels(app: Hono): void {
  app.get("/api/v1/projects/:slug/label-types", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    return json(c, await new LabelModel(getStore().db).listTypes(project.id));
  });

  app.post("/api/v1/projects/:slug/label-types", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const body = await validJson(c, createSchema);
    return json(c, await new LabelModel(getStore().db).createType(project.id, body), 201);
  });

  app.delete("/api/v1/projects/:slug/label-types/:key", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    await new LabelModel(getStore().db).removeType(project.id, c.req.param("key"));
    return c.body(null, 204);
  });
}
