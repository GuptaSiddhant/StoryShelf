import { TokenModel } from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { settingsHref } from "../pages/settings-tabs.ts";
import { CreateTokenForm } from "../pages/token-forms.tsx";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { respondWithForm } from "./form-response.tsx";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRedirect, retargetBody } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** CI token settings (create with one-time display, delete). */
export function registerTokenSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/tokens/new", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
    return respondWithForm(c, project, "access", "Create token", (standalone) => (
      <CreateTokenForm project={project} standalone={standalone} />
    ));
  });
  app.post("/projects/:slug/settings/tokens", handleCreateToken);
  app.post("/projects/:slug/settings/tokens/:tokenId/delete", handleDeleteToken);
}

async function handleCreateToken(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  const tokenName = asString(form.get("tokenName")) ?? asString(form.get("name"));
  if (!tokenName) {
    return respondWithForm(
      c,
      project,
      "access",
      "Create token",
      (standalone) => (
        <CreateTokenForm project={project} standalone={standalone} error="Name is required" />
      ),
      400,
    );
  }
  const { value } = await new TokenModel(getStore().db).issue(project.id, {
    name: tokenName,
    userId: getStore().user?.id ?? null,
  });
  flash(c, "Token created — copy it now, it is shown once");
  retargetBody(c);
  return c.html(
    (await renderSettingsPage(c, "tokens", {
      secret: value,
      origin: await getStore().publicOrigin?.url(),
    })) ?? "",
  );
}

async function handleDeleteToken(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  await new TokenModel(getStore().db).remove(c.req.param("tokenId") ?? "");
  flash(c, "Token deleted");
  return hxRedirect(c, settingsHref(project.slug, "tokens"));
}
