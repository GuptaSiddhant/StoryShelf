import type { Hono } from "hono";
import { z } from "zod";

import { LabelModel } from "../models/label.ts";
import { ProjectModel } from "../models/project.ts";
import { getStore } from "../store.ts";
import { findProjectBySlug, json, notFound, validJson } from "./helpers.ts";

const createSchema = z.object({
  name: z.string().min(1),
  gitRepository: z.string().optional(),
  gitDefaultBranch: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().optional(),
  gitRepository: z.string().optional(),
  gitDefaultBranch: z.string().optional(),
  pixelThreshold: z.number().optional(),
  maxDiffRatio: z.number().optional(),
  publicBranchRegex: z.string().nullable().optional(),
});

export function registerProjects(app: Hono): void {
  app.get("/api/v1/projects", async (c) => {
    const projects = new ProjectModel(getStore().db);
    return json(c, await projects.list());
  });

  app.post("/api/v1/projects", async (c) => {
    const body = await validJson(c, createSchema);
    const projects = new ProjectModel(getStore().db);
    const project = await projects.create(body);
    await new LabelModel(getStore().db).seedFor(project.id);
    return json(c, project, 201);
  });

  app.get("/api/v1/projects/:slug", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    return json(c, project);
  });

  app.patch("/api/v1/projects/:slug", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const updated = await new ProjectModel(getStore().db).update(project.id, await validJson(c, updateSchema));
    return json(c, updated);
  });

  app.delete("/api/v1/projects/:slug", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    await new ProjectModel(getStore().db).remove(project.id);
    return c.body(null, 204);
  });
}
