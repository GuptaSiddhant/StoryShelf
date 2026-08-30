import { createRoute, z } from "@hono/zod-openapi";

import type { ShelfApp } from "../index.tsx";
import { StatusConfigModel } from "../models/status-config.ts";
import type { ProjectStatusConfig } from "../schema.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { notFound, statusConfigCreateSchema, statusConfigSchema, unauthorized } from "./schemas.ts";

const ADMIN_ROLES = ["admin"] as const;

const listRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/status-configs",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: statusConfigSchema.array() } }, description: "List status configs" },
    ...notFound,
    ...unauthorized,
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/status-configs",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: statusConfigCreateSchema } } },
  },
  responses: {
    201: { content: { "application/json": { schema: statusConfigSchema } }, description: "Created status config" },
    400: { content: { "application/json": { schema: z.object({ message: z.string() }) } }, description: "Bad request" },
    ...notFound,
  },
});

const deleteRoute = createRoute({
  method: "delete",
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

export function registerStatusConfigs(app: ShelfApp): void {
  app.openapi(listRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, "admin");
    const model = new StatusConfigModel(getStore().db, getStore().config.secret);
    const rows = await model.list(project.id);
    return c.json(rows.map((row) => toPublic(row)));
  });

  app.openapi(createRouteDef, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    const providers = getStore().gitProviders;
    const provider = providers.find((p) => p.provider === body.provider);
    if (!provider) {
      return c.json({ message: `Unknown provider: ${body.provider}` }, 400);
    }
    const parsed = provider.configSchema.safeParse(body.config);
    if (!parsed.success) {
      return c.json({ message: parsed.error.message }, 400);
    }
    const model = new StatusConfigModel(getStore().db, getStore().config.secret);
    const row = await model.create(project.id, {
      provider: body.provider,
      config: parsed.data,
      token: body.token,
    });
    return c.json(toPublic(row), 201);
  });

  app.openapi(deleteRoute, async (c) => {
    const { slug, id } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const model = new StatusConfigModel(getStore().db, getStore().config.secret);
    const existing = await model.get(project.id, id);
    if (!existing) {
      return c.json({ message: "Status config not found" }, 404);
    }
    await model.remove(project.id, id);
    return c.body(null, 204);
  });
}
