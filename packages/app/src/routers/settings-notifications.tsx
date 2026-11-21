import { NotificationChannelModel, NotificationSubscriptionModel } from "@storyshelf/core/models";
import type { NotificationChannelRow, Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { z } from "zod";
import type { ShelfRouter } from "../app-types.ts";
import { unofferedKindMessage } from "../integrations.ts";
import {
  AddChannelForm,
  EditChannelForm,
  type ChannelFormState,
  type ChannelKind,
} from "../pages/channel-forms.tsx";
import { LISTED_TOPICS, REVIEW_REQUESTED_EVENT } from "../pages/settings-notifications.tsx";
import { settingsHref } from "../pages/settings-tabs.ts";
import { getStore } from "../store.ts";
import { parseOptionFields } from "../ui/components.tsx";
import { retryChannelState } from "./channel-retry.ts";
import { flash } from "./flash.ts";
import { respondWithForm } from "./form-response.tsx";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";
import { hxRedirect, isHxRequest } from "./htmx.ts";
import { notificationChannelModel } from "./scoped-models.ts";
import { createGitChannel } from "./settings-git-channel.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Notifications settings (message and git channels plus my preferences). */
export function registerNotificationSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/notifications/new", handleNewChannel);
  app.get("/projects/:slug/settings/notifications/:channelId/edit", handleEditChannelForm);
  app.post("/projects/:slug/settings/notifications/:channelId/edit", handleEditChannel);
  app.post("/projects/:slug/settings/notifications", handleCreateChannel);
  app.post("/projects/:slug/settings/notifications/:channelId/delete", handleDeleteChannel);
  app.post("/projects/:slug/settings/notifications/:channelId/retry", handleRetryChannel);
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

/** The message kinds the server offers (git hosts have their own form). */
function messageKinds(): ChannelKind[] {
  return getStore()
    .notifiers.filter(
      (candidate) =>
        !NotificationChannelModel.isStateKind(getStore().notifiers, candidate.metadata.kind) &&
        unofferedKindMessage(candidate.metadata.kind) === undefined,
    )
    .map((candidate) => ({ kind: candidate.metadata.kind, name: candidate.metadata.name }));
}

/** The Add form again, with what was typed and the reason it was refused. */
function addChannelAnswer(
  c: Context,
  project: Project,
  form: FormData,
  state: ChannelFormState,
): Response {
  const typed: ChannelFormState = {
    ...state,
    selected: asString(form.get("provider")),
    events: asString(form.get("events")) ?? "",
    style: asString(form.get("style")) ?? "compact",
  };
  return respondWithForm(
    c,
    project,
    "review",
    "Add channel",
    (standalone) => (
      <AddChannelForm
        project={project}
        kinds={messageKinds()}
        standalone={standalone}
        state={typed}
      />
    ),
    400,
  );
}

/** The message-channel form: a kind (an option) and its target (email address or webhook URL). */
async function createMessageChannel(
  c: Context,
  project: Project,
  form: FormData,
): Promise<Response> {
  const unoffered = unofferedKindMessage(asString(form.get("provider")) ?? "");
  if (unoffered !== undefined) {
    return refusal(c, project, form, "provider", unoffered);
  }
  const picked = parseOptionFields<{ provider: string; target: string }>(
    Object.fromEntries(form),
    "provider",
    Object.fromEntries(
      messageKinds().map((entry) => [
        entry.kind,
        z.object({ target: z.string().trim().min(1, "Enter a target") }),
      ]),
    ),
  );
  if (!picked.ok) {
    return addChannelAnswer(c, project, form, { errors: { provider: picked.error } });
  }
  return await createChannelRecord(c, project, picked.value.provider, picked.value.target, form);
}

/** Answer a refused target or provider with the form again. */
function refusal(
  c: Context,
  project: Project,
  form: FormData,
  field: "provider" | "target",
  message: string,
): Response {
  return addChannelAnswer(c, project, form, { errors: { [field]: message } });
}

async function createChannelRecord(
  c: Context,
  project: Project,
  provider: string,
  target: string,
  form: FormData,
): Promise<Response> {
  const unoffered = unofferedKindMessage(provider);
  if (unoffered !== undefined) {
    return refusal(c, project, form, "provider", unoffered);
  }
  const config = channelConfig(provider, target, form);
  const checked = await NotificationChannelModel.validateInput(
    getStore().notifiers,
    provider,
    config,
    undefined,
    provider === "email" ? undefined : target,
  );
  if (!checked.ok) {
    return refusal(
      c,
      project,
      form,
      checked.field === "provider" ? "provider" : "target",
      checked.message,
    );
  }
  await persistChannel(project, provider, target, config, form);
  flash(c, "Notification channel added");
  return hxRedirect(c, settingsHref(project.slug, "notifications"));
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

/** Admin-only: ask again for the open builds' state on one git channel (nothing else is sent). */
async function handleRetryChannel(c: Context): Promise<Response> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
  const result = await retryChannelState(project, c.req.param("channelId") ?? "");
  if (!result.ok) {
    // The shell swaps only 400, 409 and 422 into the page (ADR 0012), so the form answers a failed
    // lookup (503 on the JSON API) as 409 and the admin sees the message, not a generic toast.
    const status = result.status === 503 ? 409 : result.status;
    return c.html(
      (await renderSettingsPage(c, "notifications", { globalError: result.message })) ?? "",
      status,
    );
  }
  flash(
    c,
    result.asked === 0
      ? "No open builds to show"
      : "Retry queued. The Delivery column updates once the status is sent.",
  );
  // Back to the same row, so focus does not reset to the top of the page.
  const back = `${settingsHref(project.slug, "notifications").split("#")[0]}#channel-${c.req.param("channelId")}`;
  c.header("HX-Redirect", back);
  return isHxRequest(c) ? c.body(null, 200) : c.redirect(back, 303);
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

async function handleNewChannel(c: Context): Promise<Response> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
  return respondWithForm(c, project, "review", "Add channel", (standalone) => (
    <AddChannelForm project={project} kinds={messageKinds()} standalone={standalone} />
  ));
}

/** A message channel of this project, or a 404 (git channels have their own form). */
async function messageChannelOf(c: Context, project: Project): Promise<NotificationChannelRow> {
  const channel = await notificationChannelModel().get(c.req.param("channelId") ?? "");
  const found = channel && channel.projectId === project.id ? channel : undefined;
  if (!found || NotificationChannelModel.isStateKind(getStore().notifiers, found.provider)) {
    notFound("Channel not found");
  }
  return found;
}

/** The Edit form again, from what is stored or from what was typed and refused. */
function editChannelAnswer(
  c: Context,
  project: Project,
  channel: { id: string; provider: string; config: unknown },
  state: ChannelFormState & { to?: string | undefined },
  status: 200 | 400,
): Response {
  const kindName =
    getStore().notifiers.find((entry) => entry.metadata.kind === channel.provider)?.metadata.name ??
    channel.provider;
  return respondWithForm(
    c,
    project,
    "review",
    "Edit channel",
    (standalone) => (
      <EditChannelForm
        project={project}
        channelId={channel.id}
        kind={channel.provider}
        kindName={kindName}
        standalone={standalone}
        state={state}
      />
    ),
    status,
  );
}

async function handleEditChannelForm(c: Context): Promise<Response> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
  const channel = await messageChannelOf(c, project);
  const config = NotificationChannelModel.configOf(channel);
  return editChannelAnswer(
    c,
    project,
    channel,
    {
      to: typeof config["to"] === "string" ? config["to"] : "",
      events: NotificationChannelModel.eventsOf(channel).join(", "),
      style: typeof config["style"] === "string" ? config["style"] : "compact",
    },
    200,
  );
}

/** The refusal of an edit, or null when the edit is valid. */
async function editRefusal(
  channel: NotificationChannelRow,
  config: Record<string, unknown>,
  target: string,
): Promise<string | null> {
  const email = channel.provider === "email";
  const checked = await NotificationChannelModel.validateInput(
    getStore().notifiers,
    channel.provider,
    email ? config : { ...NotificationChannelModel.configOf(channel), ...config },
    undefined,
    email || target === "" ? undefined : target,
  );
  if (!checked.ok) {
    return checked.message;
  }
  return email && target === "" ? "Enter an email address" : null;
}

/** Persist an edit: the config and events always, the secret only for a webhook kind with a new URL. */
async function saveChannelEdit(
  channel: NotificationChannelRow,
  config: Record<string, unknown>,
  form: FormData,
  target: string,
): Promise<void> {
  const events = parseEvents(form);
  await notificationChannelModel().update(channel.id, {
    config,
    ...(events ? { events } : {}),
    ...(channel.provider === "email" || target === "" ? {} : { secret: target }),
  });
}

async function handleEditChannel(c: Context): Promise<Response> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
  return await applyEdit(c, project, await messageChannelOf(c, project));
}

async function applyEdit(
  c: Context,
  project: Project,
  channel: NotificationChannelRow,
): Promise<Response> {
  const form = await c.req.formData();
  const target = asString(form.get("target")) ?? "";
  const config = channelConfig(channel.provider, target, form);
  const problem = await editRefusal(channel, config, target);
  if (problem !== null) {
    return editChannelAnswer(c, project, channel, typedEdit(form, problem), 400);
  }
  await saveChannelEdit(channel, config, form, target);
  flash(c, "Notification channel saved");
  return hxRedirect(c, settingsHref(project.slug, "notifications"));
}

/** What the Edit form shows again after a refusal: the problem and what was typed. */
function typedEdit(
  form: FormData,
  problem: string,
): ChannelFormState & { to?: string | undefined } {
  return {
    errors: { target: problem },
    to: asString(form.get("target")) ?? "",
    events: asString(form.get("events")) ?? "",
    style: asString(form.get("style")) ?? "compact",
  };
}
