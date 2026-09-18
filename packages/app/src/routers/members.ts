import { createRoute, z } from "@hono/zod-openapi";
import { MemberModel, ProjectGroupMappingModel } from "@storyshelf/core/models";
import type { ProjectRole } from "@storyshelf/core/types";
import { projectGroupMappings, projectMembers } from "@storyshelf/db-sqlite/schema";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import {
  groupMappingCreateSchema,
  groupMappingSchema,
  memberRoleSchema,
  memberSchema,
  memberSetSchema,
  notFound,
  unauthorized,
} from "./schemas.ts";
const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const listMembersRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/members",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: memberSchema.array() } },
      description: "List project members",
    },
    ...notFound,
    ...unauthorized,
  },
});

const setMemberRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/members",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: memberSetSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: memberSchema } },
      description: "Added or updated member",
    },
    ...notFound,
  },
});

const updateMemberRoute = createRoute({
  method: "patch",
  path: "/api/v1/projects/{slug}/members/{userId}",
  request: {
    params: z.object({ slug: z.string(), userId: z.string() }),
    body: { content: { "application/json": { schema: memberRoleSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: memberSchema } },
      description: "Updated member role",
    },
    ...notFound,
  },
});

const deleteMemberRoute = createRoute({
  method: "delete",
  path: "/api/v1/projects/{slug}/members/{userId}",
  request: { params: z.object({ slug: z.string(), userId: z.string() }) },
  responses: {
    204: { description: "Removed member" },
    ...notFound,
  },
});

const listGroupMappingsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/group-mappings",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: groupMappingSchema.array() } },
      description: "List identity-provider group mappings",
    },
    ...notFound,
    ...unauthorized,
  },
});

const createGroupMappingRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/group-mappings",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: groupMappingCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: groupMappingSchema } },
      description: "Created group mapping (exact group-name match)",
    },
    ...notFound,
  },
});

const deleteGroupMappingRoute = createRoute({
  method: "delete",
  path: "/api/v1/projects/{slug}/group-mappings/{mappingId}",
  request: { params: z.object({ slug: z.string(), mappingId: z.string() }) },
  responses: {
    204: { description: "Removed group mapping" },
    ...notFound,
  },
});

/** Register the project member list, upsert, and removal endpoints. */
export function registerMembers(app: ShelfRouter): void {
  app.openapi(listMembersRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    return c.json(await new MemberModel(getStore().db, { projectMembers }).list(project.id));
  });

  app.openapi(setMemberRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    return c.json(
      await new MemberModel(getStore().db, { projectMembers }).set(
        project.id,
        body.userId,
        body.role,
      ),
      201,
    );
  });

  app.openapi(updateMemberRoute, async (c) => {
    const { slug, userId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    return c.json(
      await new MemberModel(getStore().db, { projectMembers }).set(project.id, userId, body.role),
    );
  });

  app.openapi(deleteMemberRoute, async (c) => {
    const { slug, userId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    await new MemberModel(getStore().db, { projectMembers }).remove(project.id, userId);
    return c.body(null, 204);
  });

  registerGroupMappingRoutes(app);
}

/** Register identity-provider group mapping endpoints. */
function registerGroupMappingRoutes(app: ShelfRouter): void {
  app.openapi(listGroupMappingsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    return c.json(
      await new ProjectGroupMappingModel(getStore().db, { projectGroupMappings }).list(project.id),
    );
  });

  app.openapi(createGroupMappingRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    if (body.groupName.includes("*")) {
      throw new HTTPException(400, {
        message:
          "Group names match exactly; wildcards are not expanded. A broad pattern can silently grant org-wide access.",
      });
    }
    return c.json(
      await new ProjectGroupMappingModel(getStore().db, { projectGroupMappings }).create(
        project.id,
        body.groupName,
        body.role,
      ),
      201,
    );
  });

  app.openapi(deleteGroupMappingRoute, async (c) => {
    const { slug, mappingId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    await new ProjectGroupMappingModel(getStore().db, { projectGroupMappings }).remove(
      project.id,
      mappingId,
    );
    return c.body(null, 204);
  });
}
