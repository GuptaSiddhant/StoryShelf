import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { LabelModel } from "../models/label.ts";
import { ProjectModel } from "../models/project.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { forbidden, requireSiteAdmin, resolveAuthorizedProject } from "./helpers.ts";
import {
  badRequest,
  forbidden as forbiddenResponse,
  notFound,
  projectCreateSchema,
  projectSchema,
  projectUpdateSchema,
  unauthorized,
} from "./schemas.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

function requireSessionUser(): void {
  if (!getStore().authEnabled) {
    return;
  }
  if (!getStore().user) {
    forbidden();
  }
}

const listProjectsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects",
  responses: {
    200: { content: { "application/json": { schema: projectSchema.array() } }, description: "List projects" },
    ...unauthorized,
  },
});

const createProjectRoute = createRoute({
  method: "post",
  path: "/api/v1/projects",
  request: { body: { content: { "application/json": { schema: projectCreateSchema } } } },
  responses: {
    201: { content: { "application/json": { schema: projectSchema } }, description: "Created project" },
    ...badRequest,
    ...forbiddenResponse,
    ...unauthorized,
  },
});

const getProjectRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: projectSchema } }, description: "Fetch a project" },
    ...notFound,
    ...unauthorized,
  },
});

const updateProjectRoute = createRoute({
  method: "patch",
  path: "/api/v1/projects/{slug}",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: projectUpdateSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: projectSchema } }, description: "Updated project" },
    ...forbiddenResponse,
    ...notFound,
  },
});

const deleteProjectRoute = createRoute({
  method: "delete",
  path: "/api/v1/projects/{slug}",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    204: { description: "Deleted project" },
    ...forbiddenResponse,
    ...notFound,
  },
});

export function registerProjects(app: OpenAPIHono): void {
  app.openapi(listProjectsRoute, async (c) => {
    requireSessionUser();
    const projects = new ProjectModel(getStore().db);
    return c.json(await projects.list());
  });

  app.openapi(createProjectRoute, async (c) => {
    requireSiteAdmin();
    const body = c.req.valid("json");
    const projects = new ProjectModel(getStore().db);
    const project = await projects.create(body);
    await new LabelModel(getStore().db).seedFor(project.id);
    return c.json(project, 201);
  });

  app.openapi(getProjectRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    return c.json(project);
  });

  app.openapi(updateProjectRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const updated = await new ProjectModel(getStore().db).update(project.id, c.req.valid("json"));
    return c.json(updated);
  });

  app.openapi(deleteProjectRoute, async (c) => {
    requireSiteAdmin();
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    await new ProjectModel(getStore().db).remove(project.id);
    return c.body(null, 204);
  });
}