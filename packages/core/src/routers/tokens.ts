import type { Hono } from "hono";
import { z } from "zod";

import { TokenModel } from "../models/token.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { randomToken } from "../utils/hash.ts";
import { json, notFound, resolveAuthorizedProject, validJson } from "./helpers.ts";

const createSchema = z.object({ name: z.string().min(1) });

const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

export function registerTokens(app: Hono): void {
  app.get("/api/v1/projects/:slug/tokens", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const tokens = await new TokenModel(getStore().db).list(project.id);
    return json(c, tokens.map(({ hash: _hash, ...rest }) => rest));
  });

  app.post("/api/v1/projects/:slug/tokens", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const body = await validJson(c, createSchema);
    const token = randomToken("shelf_");
    await new TokenModel(getStore().db).create(project.id, body.name, token.hash);
    return json(c, { ...body, token: token.value }, 201);
  });

  app.delete("/api/v1/projects/:slug/tokens/:tokenId", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const found = await new TokenModel(getStore().db).get(project.id, c.req.param("tokenId"));
    if (!found) {
      notFound("Token not found");
    }
    await new TokenModel(getStore().db).remove(found.id);
    return c.body(null, 204);
  });
}
