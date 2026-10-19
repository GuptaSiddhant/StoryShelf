import { createRoute, z } from "@hono/zod-openapi";
import { StatusConfigModel } from "@storyshelf/core/models";
import type { ProjectStatusConfig } from "@storyshelf/core/schema";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { notFound, statusConfigCreateSchema, statusConfigSchema, unauthorized } from "./schemas.ts";
import { statusConfigModel } from "./scoped-models.ts";
const ADMIN_ROLES = ["admin"] as const;

const listRoute = createRoute({
  method: "get",
  tags: ["Git status"],
  summary: "List status configs",
  path: "/api/v1/projects/{slug}/status-configs",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: statusConfigSchema.array() } },
      description: "List status configs",
    },
    ...notFound,
    ...unauthorized,
  },
});

const createRouteDef = createRoute({
  method: "post",
  tags: ["Git status"],
  summary: "Create a status config",
  path: "/api/v1/projects/{slug}/status-configs",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: statusConfigCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: statusConfigSchema } },
      description: "Created status config",
    },
    400: {
      content: { "application/json": { schema: z.object({ message: z.string() }) } },
      description: "Bad request",
    },
    ...notFound,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  tags: ["Git status"],
  summary: "Delete a status config",
  path: "/api/v1/projects/{slug}/status-configs/{id}",
  request: { params: z.object({ slug: z.string(), id: z.string() }) },
  responses: {
    204: { description: "Deleted status config" },
    ...notFound,
  },
});

function toPublic(row: ProjectStatusConfig): {
  id: string;
  projectId: string;
  provider: string;
  config: Record<string, unknown>;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    config: JSON.parse(row.config) as Record<string, unknown>,
    hasToken: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Register the git status-config list, create, and delete endpoints. */
export function registerStatusConfigs(app: ShelfRouter): void {
  app.openapi(listRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, "admin");
    const model = statusConfigModel();
    const rows = await model.list(project.id);
    return c.json(rows.map((row) => toPublic(row)));
  });

  app.openapi(createRouteDef, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    const checked = StatusConfigModel.validateInput(
      getStore().gitHosts,
      body.provider,
      body.config,
    );
    if (!checked.ok) {
      return c.json({ message: checked.message }, 400);
    }
    const model = statusConfigModel();
    const row = await model.create(project.id, {
      provider: body.provider,
      config: checked.config,
      token: body.token,
    });
    return c.json(toPublic(row), 201);
  });

  app.openapi(deleteRoute, async (c) => {
    const { slug, id } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const model = statusConfigModel();
    const existing = await model.get(project.id, id);
    if (!existing) {
      return c.json({ message: "Status config not found" }, 404);
    }
    await model.remove(project.id, id);
    return c.body(null, 204);
  });
}
