import type { Hono } from "hono";
import { z } from "zod";

import { TokenModel } from "../models/token.ts";
import { getStore } from "../store.ts";
import { randomToken } from "../utils/hash.ts";
import { findProjectBySlug, json, notFound, validJson } from "./helpers.ts";

const createSchema = z.object({ name: z.string().min(1) });

export function registerTokens(app: Hono): void {
  app.get("/api/v1/projects/:slug/tokens", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const tokens = await new TokenModel(getStore().db).list(project.id);
    return json(c, tokens.map(({ hash: _hash, ...rest }) => rest));
  });

  app.post("/api/v1/projects/:slug/tokens", async (c) => {
    const project = await findProjectBySlug(c.req.param("slug"));
    if (!project) {
      notFound("Project not found");
    }
    const body = await validJson(c, createSchema);
    const token = randomToken("shelf_");
    await new TokenModel(getStore().db).create(project.id, body.name, token.hash);
    return json(c, { ...body, token: token.value }, 201);
  });

  app.delete("/api/v1/projects/:slug/tokens/:tokenId", async (c) => {
    await new TokenModel(getStore().db).remove(c.req.param("tokenId"));
    return c.body(null, 204);
  });
}
