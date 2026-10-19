import { WebhookModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { flash } from "./flash.ts";
import { notFound } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { webhookModel } from "./scoped-models.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** Webhook settings (create with one-time secret display, delete). */
export function registerWebhookSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/webhooks", async (c) =>
    c.html(await renderSettingsPage(c, "webhooks")),
  );
  app.post("/projects/:slug/settings/webhooks", handleCreateWebhook);
  app.post("/projects/:slug/settings/webhooks/:webhookId/delete", handleDeleteWebhook);
}

/** Parse the comma-separated events field. */
function parseWebhookEvents(form: FormData): string[] | undefined {
  const eventsRaw = asString(form.get("events"));
  if (!eventsRaw) {
    return undefined;
  }
  return eventsRaw
    .split(",")
    .map((event) => event.trim())
    .filter((event) => event.length > 0);
}

async function handleCreateWebhook(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  const url = asString(form.get("url"));
  const urlError = WebhookModel.urlError(url);
  if (urlError || !url) {
    return c.html(
      (await renderSettingsPage(c, "webhooks", { errors: { url: urlError ?? "Invalid URL" } })) ??
        "",
      400,
    );
  }
  return await createWebhookRecord(c, project, url, parseWebhookEvents(form));
}

async function createWebhookRecord(
  c: Context,
  project: Project,
  url: string,
  events: string[] | undefined,
): Promise<Response> {
  const { secret } = await webhookModel().issue(project.id, { url, events });
  flash(c, "Webhook created — copy the signing secret now");
  return c.html((await renderSettingsPage(c, "webhooks", { secret })) ?? "", 201);
}

async function handleDeleteWebhook(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const webhook = await webhookModel().get(project.id, c.req.param("webhookId") ?? "");
  if (!webhook) {
    notFound("Webhook not found");
  }
  await webhookModel().remove(project.id, webhook.id);
  flash(c, "Webhook deleted");
  return hxRedirect(c, `/projects/${project.slug}/settings/webhooks`);
}
