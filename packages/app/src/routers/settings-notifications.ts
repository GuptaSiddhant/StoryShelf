import { NotificationChannelModel, NotificationSubscriptionModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Notifications settings (channels plus my preferences). */
export function registerNotificationSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/notifications", async (c) =>
    c.html(await renderSettingsPage(c, "notifications")),
  );
  app.post("/projects/:slug/settings/notifications", handleCreateChannel);
  app.post("/projects/:slug/settings/notifications/:channelId/delete", handleDeleteChannel);
  app.post("/projects/:slug/settings/notifications/me", handleSaveMine);
}

/** Parse the comma-separated events field. */
function parseEvents(form: FormData): string[] | undefined {
  const raw = asString(form.get("events"));
  if (!raw) {
    return undefined;
  }
  const events = raw
    .split(",")
    .map((event) => event.trim())
    .filter((event) => event.length > 0);
  return events.length > 0 ? events : undefined;
}

/** Parse repeated checkbox values (topics). */
function parseChecks(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function handleCreateChannel(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  const provider = asString(form.get("provider"));
  const target = asString(form.get("target"));
  if (provider && target) {
    return await createChannelRecord(c, project, provider, target, form);
  }
  const missing = provider ? "target" : "provider";
  const message = provider ? "Enter a target" : "Choose a provider";
  return c.html(
    (await renderSettingsPage(c, "notifications", { errors: { [missing]: message } })) ?? "",
    400,
  );
}

/** Render the tab with a provider-field error. */
async function providerError(c: Context, message: string): Promise<Response> {
  return c.html(
    (await renderSettingsPage(c, "notifications", { errors: { provider: message } })) ?? "",
    400,
  );
}

/** Render the tab with a target-field error. */
async function targetError(c: Context, message: string): Promise<Response> {
  return c.html(
    (await renderSettingsPage(c, "notifications", { errors: { target: message } })) ?? "",
    400,
  );
}

async function createChannelRecord(
  c: Context,
  project: Project,
  provider: string,
  target: string,
  form: FormData,
): Promise<Response> {
  const descriptor = getStore().notifiers.find((candidate) => candidate.metadata.kind === provider);
  if (!descriptor) {
    return await providerError(c, `Unknown provider: ${provider}`);
  }
  const parsed = descriptor.metadata.schema.safeParse(channelConfig(provider, target, form));
  if (!parsed.success) {
    return await targetError(c, parsed.error.message);
  }
  await persistChannel(project, provider, target, parsed.data, form);
  flash(c, "Notification channel added");
  return c.html((await renderSettingsPage(c, "notifications")) ?? "", 201);
}

/** Build the provider config from the form (address vs secret per kind). */
function channelConfig(provider: string, target: string, form: FormData): Record<string, unknown> {
  const style = asString(form.get("style")) ?? "compact";
  if (provider === "email") {
    return { to: target, style };
  }
  return { style };
}

/** Persist a validated channel (webhook URLs land in the secret column). */
async function persistChannel(
  project: Project,
  provider: string,
  target: string,
  config: unknown,
  form: FormData,
): Promise<void> {
  await new NotificationChannelModel(
    getStore().db,
    undefined,
    credentialKeys(getStore().config),
  ).create({
    projectId: project.id,
    provider,
    config: config as Record<string, unknown>,
    secret: provider === "email" ? undefined : target,
    events: parseEvents(form),
  });
}

async function handleDeleteChannel(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const model = new NotificationChannelModel(
    getStore().db,
    undefined,
    credentialKeys(getStore().config),
  );
  const channel = await model.get(c.req.param("channelId") ?? "");
  if (!channel || channel.projectId !== project.id) {
    return c.html(
      (await renderSettingsPage(c, "notifications", {
        globalError: "Channel not found",
      })) ?? "",
      404,
    );
  }
  await model.remove(channel.id);
  flash(c, "Notification channel removed");
  return c.html((await renderSettingsPage(c, "notifications")) ?? "");
}

async function handleSaveMine(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const user = getStore().user;
  if (user) {
    await saveSubscription(project, user.id, await c.req.formData());
    flash(c, "Notification preferences saved");
    return c.html((await renderSettingsPage(c, "notifications")) ?? "");
  }
  return c.html(
    (await renderSettingsPage(c, "notifications", {
      globalError: "Sign in to save notification preferences",
    })) ?? "",
    401,
  );
}

/** Persist the viewer's own subscription (unchecked means opt out). */
async function saveSubscription(project: Project, userId: string, form: FormData): Promise<void> {
  const model = new NotificationSubscriptionModel(getStore().db);
  if (form.get("enabled") === "on") {
    await model.upsert(project.id, userId, { events: parseChecks(form, "events"), via: ["email"] });
    return;
  }
  await model.remove(project.id, userId);
}
