import { z } from "@hono/zod-openapi";
import { TokenModel } from "@storyshelf/core/models";
import { randomToken } from "@storyshelf/core/utils";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject, notFound } from "./helpers.ts";
import { ADMIN_ROLES } from "./roles.ts";
import { deleteRouteDef, listRouteDef, postRouteDef } from "./route-defs.ts";
import { tokenCreatedSchema, tokenCreateSchema, tokenPublicSchema } from "./schemas.ts";

const listTokensRoute = listRouteDef({
  tag: "Tokens",
  summary: "List API tokens",
  path: "/api/v1/projects/{slug}/tokens",
  schema: tokenPublicSchema,
  description: "List API tokens",
});

const createTokenRoute = postRouteDef({
  tag: "Tokens",
  summary: "Create an API token",
  path: "/api/v1/projects/{slug}/tokens",
  body: tokenCreateSchema,
  schema: tokenCreatedSchema,
  description: "Created token",
});

const deleteTokenRoute = deleteRouteDef({
  tag: "Tokens",
  summary: "Delete an API token",
  path: "/api/v1/projects/{slug}/tokens/{tokenId}",
  params: { tokenId: z.string() },
  description: "Deleted token",
});

/** Register the project API token list, create, and revoke endpoints. */
export function registerTokens(app: ShelfRouter): void {
  app.openapi(listTokensRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const tokens = await new TokenModel(getStore().db).list(project.id);
    return c.json(tokens.map(({ hash: _hash, ...rest }) => rest));
  });

  app.openapi(createTokenRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    const token = randomToken("shelf_");
    await new TokenModel(getStore().db).create(project.id, {
      name: body.name,
      hash: token.hash,
      userId: getStore().user?.id ?? null,
    });
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
