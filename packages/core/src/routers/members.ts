import type { Hono } from "hono";
import { z } from "zod";

import { MemberModel } from "../models/member.ts";
import { getStore } from "../store.ts";
import { PROJECT_ROLES } from "../types.ts";
import { findProjectBySlug, json, notFound, validJson } from "./helpers.ts";

const roleSchema = z.object({ role: z.enum(PROJECT_ROLES) });
const setSchema = z.object({ userId: z.string().min(1), role: z.enum(PROJECT_ROLES) });

export function registerMembers(app: Hono): void {
  app.get("/api/v1/projects/:slug/members", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    return json(c, await new MemberModel(getStore().db).list(project.id));
  });

  app.post("/api/v1/projects/:slug/members", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const body = await validJson(c, setSchema);
    return json(c, await new MemberModel(getStore().db).set(project.id, body.userId, body.role), 201);
  });

  app.patch("/api/v1/projects/:slug/members/:userId", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const body = await validJson(c, roleSchema);
    return json(c, await new MemberModel(getStore().db).set(project.id, c.req.param("userId"), body.role));
  });

  app.delete("/api/v1/projects/:slug/members/:userId", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    await new MemberModel(getStore().db).remove(project.id, c.req.param("userId"));
    return c.body(null, 204);
  });
}
