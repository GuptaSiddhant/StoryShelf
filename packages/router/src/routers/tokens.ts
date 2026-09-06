import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";
import { TokenModel } from "../models/token.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { randomToken } from "../utils/hash.ts";
import { resolveAuthorizedProject, notFound } from "./helpers.ts";
import {
  notFound as notFoundResponse,
  tokenCreatedSchema,
  tokenCreateSchema,
  tokenPublicSchema,
  unauthorized,
} from "./schemas.ts";

const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const listTokensRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/tokens",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: tokenPublicSchema.array() } },
      description: "List API tokens",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const createTokenRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/tokens",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: tokenCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: tokenCreatedSchema } },
      description: "Created token",
    },
    ...notFoundResponse,
  },
});

const deleteTokenRoute = createRoute({
  method: "delete",
  path: "/api/v1/projects/{slug}/tokens/{tokenId}",
  request: { params: z.object({ slug: z.string(), tokenId: z.string() }) },
  responses: {
    204: { description: "Deleted token" },
    ...notFoundResponse,
  },
});

/** Register the project API token list, create, and revoke endpoints. */
export function registerTokens(app: ShelfApp): void {
  app.openapi(listTokensRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const tokens = await new TokenModel(getStore().db).list(project.id);
    return c.json(tokens.map(({ hash: _hash, ...rest }) => rest));
  });

  app.openapi(createTokenRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    const token = randomToken("shelf_");
    await new TokenModel(getStore().db).create(project.id, body.name, token.hash);
    return c.json({ ...body, token: token.value }, 201);
  });

  app.openapi(deleteTokenRoute, async (c) => {
    const { slug, tokenId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const found = await new TokenModel(getStore().db).get(project.id, tokenId);
    if (!found) {
      notFound("Token not found");
    }
    await new TokenModel(getStore().db).remove(found.id);
    return c.body(null, 204);
  });
}
