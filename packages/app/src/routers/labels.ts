import { z } from "@hono/zod-openapi";
import { LabelModel } from "@storyshelf/core/models";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { ADMIN_ROLES, VIEW_ROLES } from "./roles.ts";
import { deleteRouteDef, listRouteDef, patchRouteDef, postRouteDef } from "./route-defs.ts";
import { labelTypeCreateSchema, labelTypeSchema, labelTypeUpdateSchema } from "./schemas.ts";

const listLabelsRoute = listRouteDef({
  tag: "Labels",
  summary: "List label types",
  path: "/api/v1/projects/{slug}/label-types",
  schema: labelTypeSchema,
  description: "List label types",
});

const createLabelRoute = postRouteDef({
  tag: "Labels",
  summary: "Create a label type",
  path: "/api/v1/projects/{slug}/label-types",
  body: labelTypeCreateSchema,
  schema: labelTypeSchema,
  description: "Created label type",
});

const deleteLabelRoute = deleteRouteDef({
  tag: "Labels",
  summary: "Delete a label type",
  path: "/api/v1/projects/{slug}/label-types/{key}",
  params: { key: z.string() },
  description: "Deleted label type",
});

const updateLabelRoute = patchRouteDef({
  tag: "Labels",
  summary: "Update a label type",
  path: "/api/v1/projects/{slug}/label-types/{key}",
  params: { key: z.string() },
  body: labelTypeUpdateSchema,
  schema: labelTypeSchema,
  description: "Updated label type",
});

/** Register the project label-type list, create, update, and delete endpoints. */
export function registerLabels(app: ShelfRouter): void {
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
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : "Cannot update label type",
      });
    }
  });
}
