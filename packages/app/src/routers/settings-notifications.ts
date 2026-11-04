import { NotificationChannelModel, NotificationSubscriptionModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { LISTED_TOPICS, REVIEW_REQUESTED_EVENT } from "../pages/settings-notifications.tsx";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { notificationChannelModel } from "./scoped-models.ts";
import { createGitChannel } from "./settings-git-channel.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Notifications settings (message and git channels plus my preferences). */
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
  const gitProvider = asString(form.get("gitProvider"));
  return gitProvider
    ? await createGitChannel(c, project, gitProvider, form)
    : await createMessageChannel(c, project, form);
}

/** The message-channel form: a provider and a target (email address or webhook URL). */
async function createMessageChannel(
  c: Context,
  project: Project,
  form: FormData,
): Promise<Response> {
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
  const config = channelConfig(provider, target, form);
  const checked = NotificationChannelModel.validateInput(getStore().notifiers, provider, config);
  if (!checked.ok) {
    return checked.field === "provider"
      ? await providerError(c, checked.message)
      : await targetError(c, checked.message);
  }
  await persistChannel(project, provider, target, config, form);
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
  await notificationChannelModel().create({
    projectId: project.id,
    provider,
    config: config as Record<string, unknown>,
    secret: provider === "email" ? undefined : target,
    events: parseEvents(form),
  });
}

async function handleDeleteChannel(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const model = notificationChannelModel();
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
  flash(c, "Channel removed");
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

/**
 * The topics to store: `undefined` (all) when none or every listed topic is ticked, else the
 * ticked ones plus `review:requested`, which the review switch alone controls (it has no
 * checkbox, so a partial list must not leave it out). Ticking everything must not freeze today's
 * list, or an event added later would be missed.
 */
function topicsToStore(ticked: string[]): string[] | undefined {
  const all = ticked.length === 0 || LISTED_TOPICS.every((entry) => ticked.includes(entry.event));
  return all ? undefined : [...ticked, REVIEW_REQUESTED_EVENT];
}

/**
 * The channels to store when "Email me" is on: those already chosen stay, and email is added when
 * the row is new, switched off or has none (the form only offers email, so it must not drop
 * channels set elsewhere, such as through the API).
 */
async function channelsToStore(
  model: NotificationSubscriptionModel,
  projectId: string,
  userId: string,
): Promise<string[]> {
  const existing = await model.getFor(projectId, userId);
  const kept = existing ? NotificationSubscriptionModel.viaOf(existing) : [];
  return existing?.enabled === true && kept.length > 0 ? kept : [...new Set([...kept, "email"])];
}

/**
 * Persist the viewer's own preferences. "Email me" off keeps the row (switched off) rather than
 * deleting it, which would hand them back to the default recipients; the review-request switch
 * changes only its own column.
 */
async function saveSubscription(project: Project, userId: string, form: FormData): Promise<void> {
  const model = new NotificationSubscriptionModel(getStore().db);
  const reviewRequests = form.get("reviewRequests") === "on";
  if (form.get("enabled") === "on") {
    await model.upsert(project.id, userId, {
      events: topicsToStore(parseChecks(form, "events")),
      via: await channelsToStore(model, project.id, userId),
      reviewRequests,
    });
    return;
  }
  await model.setEnabled(project.id, userId, false);
  await model.setReviewRequests(project.id, userId, reviewRequests);
}
