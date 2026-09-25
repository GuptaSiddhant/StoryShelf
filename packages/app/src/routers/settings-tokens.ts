import { TokenModel } from "@storyshelf/core/models";
import { randomToken } from "@storyshelf/core/utils";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** CI token settings (create with one-time display, delete). */
export function registerTokenSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/tokens", async (c) =>
    c.html(await renderSettingsPage(c, "tokens")),
  );
  app.post("/projects/:slug/settings/tokens", handleCreateToken);
  app.post("/projects/:slug/settings/tokens/:tokenId/delete", handleDeleteToken);
}

async function handleCreateToken(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  const tokenName = asString(form.get("tokenName")) ?? asString(form.get("name"));
  if (!tokenName) {
    return c.html(
      (await renderSettingsPage(c, "tokens", { globalError: "Name is required" })) ?? "",
      400,
    );
  }
  const token = randomToken("shelf_");
  await new TokenModel(getStore().db, { tokens: getStore().db.tables.tokens }).create(project.id, {
    name: tokenName,
    hash: token.hash,
    userId: getStore().user?.id ?? null,
  });
  return c.html((await renderSettingsPage(c, "tokens", { secret: token.value })) ?? "");
}

async function handleDeleteToken(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  await new TokenModel(getStore().db, { tokens: getStore().db.tables.tokens }).remove(
    c.req.param("tokenId") ?? "",
  );
  return hxRedirect(c, `/projects/${project.slug}/settings/tokens`);
}
