import type { Hono } from "hono";
import { z } from "zod";

import { MemberModel } from "../models/member.ts";
import { getStore } from "../store.ts";
import { PROJECT_ROLES, type ProjectRole } from "../types.ts";
import { json, resolveAuthorizedProject, validJson } from "./helpers.ts";

const roleSchema = z.object({ role: z.enum(PROJECT_ROLES) });
const setSchema = z.object({ userId: z.string().min(1), role: z.enum(PROJECT_ROLES) });

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

export function registerMembers(app: Hono): void {
  app.get("/api/v1/projects/:slug/members", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...VIEW_ROLES);
    return json(c, await new MemberModel(getStore().db).list(project.id));
  });

  app.post("/api/v1/projects/:slug/members", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const body = await validJson(c, setSchema);
    return json(c, await new MemberModel(getStore().db).set(project.id, body.userId, body.role), 201);
  });

  app.patch("/api/v1/projects/:slug/members/:userId", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const body = await validJson(c, roleSchema);
    return json(c, await new MemberModel(getStore().db).set(project.id, c.req.param("userId"), body.role));
  });

  app.delete("/api/v1/projects/:slug/members/:userId", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    await new MemberModel(getStore().db).remove(project.id, c.req.param("userId"));
    return c.body(null, 204);
  });
}
