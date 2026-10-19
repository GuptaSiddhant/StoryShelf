import { z } from "@hono/zod-openapi";
import { MemberModel, ProjectGroupMappingModel } from "@storyshelf/core/models";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { ADMIN_ROLES, VIEW_ROLES } from "./roles.ts";
import { deleteRouteDef, listRouteDef, patchRouteDef, postRouteDef } from "./route-defs.ts";
import {
  groupMappingCreateSchema,
  groupMappingSchema,
  memberRoleSchema,
  memberSchema,
  memberSetSchema,
} from "./schemas.ts";

const listMembersRoute = listRouteDef({
  tag: "Members",
  summary: "List members",
  path: "/api/v1/projects/{slug}/members",
  schema: memberSchema,
  description: "List project members",
});

const setMemberRoute = postRouteDef({
  tag: "Members",
  summary: "Add or update a member",
  path: "/api/v1/projects/{slug}/members",
  body: memberSetSchema,
  schema: memberSchema,
  description: "Added or updated member",
});

const updateMemberRoute = patchRouteDef({
  tag: "Members",
  summary: "Change a member's role",
  path: "/api/v1/projects/{slug}/members/{userId}",
  params: { userId: z.string() },
  body: memberRoleSchema,
  schema: memberSchema,
  description: "Updated member role",
});

const deleteMemberRoute = deleteRouteDef({
  tag: "Members",
  summary: "Remove a member",
  path: "/api/v1/projects/{slug}/members/{userId}",
  params: { userId: z.string() },
  description: "Removed member",
});

const listGroupMappingsRoute = listRouteDef({
  tag: "Members",
  summary: "List group mappings",
  path: "/api/v1/projects/{slug}/group-mappings",
  schema: groupMappingSchema,
  description: "List identity-provider group mappings",
});

const createGroupMappingRoute = postRouteDef({
  tag: "Members",
  summary: "Create a group mapping",
  path: "/api/v1/projects/{slug}/group-mappings",
  body: groupMappingCreateSchema,
  schema: groupMappingSchema,
  description: "Created group mapping (exact group-name match)",
});

const deleteGroupMappingRoute = deleteRouteDef({
  tag: "Members",
  summary: "Remove a group mapping",
  path: "/api/v1/projects/{slug}/group-mappings/{mappingId}",
  params: { mappingId: z.string() },
  description: "Removed group mapping",
});

/** Register the project member list, upsert, and removal endpoints. */
export function registerMembers(app: ShelfRouter): void {
  app.openapi(listMembersRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    return c.json(await new MemberModel(getStore().db).list(project.id));
  });

  app.openapi(setMemberRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    return c.json(
      await new MemberModel(getStore().db).set(project.id, body.userId, body.role),
      201,
    );
  });

  app.openapi(updateMemberRoute, async (c) => {
    const { slug, userId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    return c.json(await new MemberModel(getStore().db).set(project.id, userId, body.role));
  });

  app.openapi(deleteMemberRoute, async (c) => {
    const { slug, userId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    await new MemberModel(getStore().db).remove(project.id, userId);
    return c.body(null, 204);
  });

  registerGroupMappingRoutes(app);
}

/** Register identity-provider group mapping endpoints. */
function registerGroupMappingRoutes(app: ShelfRouter): void {
  app.openapi(listGroupMappingsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    return c.json(await new ProjectGroupMappingModel(getStore().db).list(project.id));
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
      await new ProjectGroupMappingModel(getStore().db).create(
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
    await new ProjectGroupMappingModel(getStore().db).remove(project.id, mappingId);
    return c.body(null, 204);
  });
}
