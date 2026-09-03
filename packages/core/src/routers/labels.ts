import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ShelfApp } from "../index.tsx";

import { LabelModel } from "../models/label.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { labelTypeCreateSchema, labelTypeSchema, labelTypeUpdateSchema, notFound, unauthorized } from "./schemas.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const listLabelsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/label-types",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: labelTypeSchema.array() } }, description: "List label types" },
    ...notFound,
    ...unauthorized,
  },
});

const createLabelRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/label-types",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: labelTypeCreateSchema } } },
  },
  responses: {
    201: { content: { "application/json": { schema: labelTypeSchema } }, description: "Created label type" },
    ...notFound,
  },
});

const deleteLabelRoute = createRoute({
  method: "delete",
  path: "/api/v1/projects/{slug}/label-types/{key}",
  request: { params: z.object({ slug: z.string(), key: z.string() }) },
  responses: {
    204: { description: "Deleted label type" },
    ...notFound,
  },
});

const updateLabelRoute = createRoute({
  method: "patch",
  path: "/api/v1/projects/{slug}/label-types/{key}",
  request: {
    params: z.object({ slug: z.string(), key: z.string() }),
    body: { content: { "application/json": { schema: labelTypeUpdateSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: labelTypeSchema } }, description: "Updated label type" },
    ...notFound,
  },
});

export function registerLabels(app: ShelfApp): void {
  app.openapi(listLabelsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    return c.json(await new LabelModel(getStore().db).listTypes(project.id));
  });

  app.openapi(createLabelRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    return c.json(await new LabelModel(getStore().db).createType(project.id, body), 201);
  });

  app.openapi(deleteLabelRoute, async (c) => {
    const { slug, key } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    await new LabelModel(getStore().db).removeType(project.id, key);
    return c.body(null, 204);
  });

  app.openapi(updateLabelRoute, async (c) => {
    const { slug, key } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    try {
      const updated = await new LabelModel(getStore().db).updateType(project.id, key, body);
      if (!updated) {
        throw new HTTPException(404, { message: "Label type not found" });
      }
      return c.json(updated);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(400, { message: error instanceof Error ? error.message : "Cannot update label type" });
    }
  });
}