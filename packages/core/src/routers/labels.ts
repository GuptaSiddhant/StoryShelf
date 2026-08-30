import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { LabelModel } from "../models/label.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { labelTypeCreateSchema, labelTypeSchema, notFound, unauthorized } from "./schemas.ts";

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

export function registerLabels(app: OpenAPIHono): void {
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
}