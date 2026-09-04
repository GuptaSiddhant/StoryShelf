import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";

import { MemberModel } from "../models/member.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { memberRoleSchema, memberSchema, memberSetSchema, notFound, unauthorized } from "./schemas.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const listMembersRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/members",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: memberSchema.array() } }, description: "List project members" },
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
    201: { content: { "application/json": { schema: memberSchema } }, description: "Added or updated member" },
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
    200: { content: { "application/json": { schema: memberSchema } }, description: "Updated member role" },
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

/** Register the project member list, upsert, and removal endpoints. */
export function registerMembers(app: ShelfApp): void {
  app.openapi(listMembersRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    return c.json(await new MemberModel(getStore().db).list(project.id));
  });

  app.openapi(setMemberRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    return c.json(await new MemberModel(getStore().db).set(project.id, body.userId, body.role), 201);
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
}