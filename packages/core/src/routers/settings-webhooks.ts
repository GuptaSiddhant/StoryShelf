import type { Context } from "hono";
import type { ShelfApp } from "../index.tsx";
import { WebhookModel } from "../models/webhook.ts";
import type { Project } from "../schema/project.ts";
import { getStore } from "../store.ts";
import { randomToken } from "../utils/hash.ts";
import { notFound } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Webhook settings (create with one-time secret display, delete). */
export function registerWebhookSettings(app: ShelfApp): void {
  app.get("/projects/:slug/settings/webhooks", async (c) =>
    c.html(await renderSettingsPage(c, "webhooks")),
  );
  app.post("/projects/:slug/settings/webhooks", handleCreateWebhook);
  app.post("/projects/:slug/settings/webhooks/:webhookId/delete", handleDeleteWebhook);
}

/** Validate a webhook URL, returning the error message or null when valid. */
function webhookUrlError(url: string | undefined): string | null {
  if (!url) {
    return "A valid URL is required";
  }
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return "Enter a valid URL";
  }
  if (protocol !== "https:" && protocol !== "http:") {
    return "URL must use http or https";
  }
  return null;
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
  const urlError = webhookUrlError(url);
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
  const webhookModel = new WebhookModel(getStore().db);
  const secret = randomToken("whsec_").value;
  await webhookModel.create(project.id, { url, events, secret });
  return c.html((await renderSettingsPage(c, "webhooks", { secret })) ?? "", 201);
}

async function handleDeleteWebhook(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const webhook = await new WebhookModel(getStore().db).get(project.id, c.req.param("webhookId") ?? "");
  if (!webhook) {
    notFound("Webhook not found");
  }
  await new WebhookModel(getStore().db).remove(project.id, webhook.id);
  return hxRedirect(c, `/projects/${project.slug}/settings/webhooks`);
}
