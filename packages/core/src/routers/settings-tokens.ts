import type { Context } from "hono";
import type { ShelfApp } from "../index.tsx";
import { TokenModel } from "../models/token.ts";
import { getStore } from "../store.ts";
import { randomToken } from "../utils/hash.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** CI token settings (create with one-time display, delete). */
export function registerTokenSettings(app: ShelfApp): void {
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
  await new TokenModel(getStore().db).create(project.id, tokenName, token.hash);
  return await renderTokenCreated(c, token.value);
}

/** Re-render the tokens tab with the one-time secret banner injected. */
async function renderTokenCreated(c: Context, tokenValue: string): Promise<Response> {
  const html = await renderSettingsPage(c, "tokens");
  const inject = `<div class="alert alert--success" role="alert"><strong class="alert__title">Token created</strong><div class="alert__body">Copy now — shown once: <code>${tokenValue}</code></div></div>`;
  const withToken = html.replace('<nav class="tabs"', `${inject}<nav class="tabs"`);
  return c.html(withToken);
}

async function handleDeleteToken(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  await new TokenModel(getStore().db).remove(c.req.param("tokenId") ?? "");
  return hxRedirect(c, `/projects/${project.slug}/settings/tokens`);
}
