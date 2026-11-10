import { createRoute, z } from "@hono/zod-openapi";
import { LabelModel } from "@storyshelf/core/models";
import type { LabelType } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import { isUserFacingError } from "@storyshelf/core/utils";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { publicMessage, resolveAuthorizedProject } from "./helpers.ts";
import {
  errorSchema,
  labelTypeCreateSchema,
  labelTypeSchema,
  labelTypeUpdateSchema,
  notFound,
  unauthorized,
} from "./schemas.ts";
const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const listLabelsRoute = createRoute({
  method: "get",
  tags: ["Labels"],
  summary: "List label types",
  path: "/api/v1/projects/{slug}/label-types",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: labelTypeSchema.array() } },
      description: "List label types",
    },
    ...notFound,
    ...unauthorized,
  },
});

const createLabelRoute = createRoute({
  method: "post",
  tags: ["Labels"],
  summary: "Create a label type",
  path: "/api/v1/projects/{slug}/label-types",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: labelTypeCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: labelTypeSchema } },
      description: "Created label type",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "The project already has a label type with this key",
    },
    ...notFound,
  },
});

const deleteLabelRoute = createRoute({
  method: "delete",
  tags: ["Labels"],
  summary: "Delete a label type",
  path: "/api/v1/projects/{slug}/label-types/{key}",
  request: { params: z.object({ slug: z.string(), key: z.string() }) },
  responses: {
    204: { description: "Deleted label type" },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "A reserved label type cannot be removed",
    },
    ...notFound,
  },
});

const updateLabelRoute = createRoute({
  method: "patch",
  tags: ["Labels"],
  summary: "Update a label type",
  path: "/api/v1/projects/{slug}/label-types/{key}",
  request: {
    params: z.object({ slug: z.string(), key: z.string() }),
    body: { content: { "application/json": { schema: labelTypeUpdateSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: labelTypeSchema } },
      description: "Updated label type",
    },
    ...notFound,
  },
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
    const created = await refusing(
      409,
      async () => await new LabelModel(getStore().db).createType(project.id, body),
    );
    return c.json(created, 201);
  });

  app.openapi(deleteLabelRoute, async (c) => {
    const { slug, key } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    await refusing(400, async () => {
      await new LabelModel(getStore().db).removeType(project.id, key);
    });
    return c.body(null, 204);
  });

  app.openapi(updateLabelRoute, async (c) => {
    const { slug, key } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    return c.json(await updateLabelType(project.id, key, c.req.valid("json")));
  });
}

/** Update a label type; an unknown key is a 404 and a refused change a 400 (its own message). */
async function updateLabelType(
  projectId: string,
  key: string,
  body: Parameters<LabelModel["updateType"]>[2],
): Promise<LabelType> {
  try {
    const updated = await new LabelModel(getStore().db).updateType(projectId, key, body);
    if (!updated) {
      throw new HTTPException(404, { message: "Label type not found" });
    }
    return updated;
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(400, {
      message: publicMessage(error, "Cannot update label type"),
    });
  }
}

/** Run `action`; a deliberate refusal (a `UserFacingError`) is answered with `status` and its own message. */
async function refusing<T>(status: 400 | 409, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isUserFacingError(error)) {
      throw new HTTPException(status, { message: error.message });
    }
    throw error;
  }
}
