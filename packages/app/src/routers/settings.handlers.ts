import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import { LabelModel } from "@storyshelf/core/models";
import { MemberModel } from "@storyshelf/core/models";
import { NotificationChannelModel } from "@storyshelf/core/models";
import { NotificationSubscriptionModel } from "@storyshelf/core/models";
import { ProjectGroupMappingModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { StatusConfigModel } from "@storyshelf/core/models";
import { TokenModel } from "@storyshelf/core/models";
import { WebhookModel } from "@storyshelf/core/models";
import type { LabelType } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import type { AuthUser } from "@storyshelf/core/types";
import type { Context } from "hono";
import {
  renderProjectSettingsPage,
  type SettingsFormState,
  type SettingsTab,
} from "../pages/project-settings.tsx";
import type { SettingsMember } from "../pages/settings-members.tsx";
import type {
  SettingsMySubscription,
  SettingsNotificationChannel,
} from "../pages/settings-notifications.tsx";
import type { SettingsStatusConfig } from "../pages/settings-status.tsx";
import type { SettingsWebhook } from "../pages/settings-webhooks.tsx";
import { getStore } from "../store.ts";
import { notFound } from "./helpers.ts";
/** Aggregated data for rendering a settings tab. */
export interface SettingsData {
  project: Project;
  labelTypes: LabelType[];
  tokens: Omit<Token, "hash">[];
  members: SettingsMember[];
  groupMappings: ProjectGroupMapping[];
  webhooks: SettingsWebhook[];
  notificationChannels: SettingsNotificationChannel[];
  notifyProviders: string[];
  mySubscription: SettingsMySubscription | null;
  statusConfigs: SettingsStatusConfig[];
  gitHosts: GitHostProvider[];
  isAdmin: boolean;
}

/** Tokens without hashes for the settings UI. */
async function loadTokenSummaries(
  db: DatabaseAdapter,
  projectId: string,
): Promise<Omit<Token, "hash">[]> {
  const tokensDb = await new TokenModel(db).list(projectId);
  return tokensDb.map(({ hash: _hash, ...rest }) => rest);
}

/** Webhook summaries for the settings UI. */
async function loadWebhookSummaries(
  db: DatabaseAdapter,
  projectId: string,
): Promise<SettingsWebhook[]> {
  const webhooksDb = await new WebhookModel(db).list(projectId);
  return webhooksDb.map((webhook) => ({
    id: webhook.id,
    url: webhook.url,
    events: WebhookModel.eventsOf(webhook),
  }));
}

/** Status-config summaries for the settings UI. */
async function loadStatusConfigSummaries(
  db: DatabaseAdapter,
  secret: string | undefined,
  projectId: string,
): Promise<SettingsStatusConfig[]> {
  const statusConfigsDb = await new StatusConfigModel(db, undefined, secret).list(projectId);
  return statusConfigsDb.map((row) => ({
    id: row.id,
    provider: row.provider,
    config: JSON.parse(row.config) as Record<string, unknown>,
    hasToken: row.tokenEncrypted.length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** True when the user may administer the project. */
function isProjectAdmin(
  authEnabled: boolean,
  user: AuthUser | null,
  members: SettingsMember[],
): boolean {
  return (
    !authEnabled ||
    user?.role === "admin" ||
    members.some((member) => member.userId === user?.id && member.role === "admin")
  );
}

/** Label types + member roster for the settings UI. */
async function loadProjectRoster(
  db: DatabaseAdapter,
  projectId: string,
): Promise<{ labelTypes: LabelType[]; members: SettingsMember[] }> {
  const labelTypes = await new LabelModel(db).listTypes(projectId);
  const members = await new MemberModel(db).list(projectId);
  return { labelTypes, members };
}

/** Label types + member roster + group mappings for the settings UI. */
async function loadMembersSection(
  db: DatabaseAdapter,
  projectId: string,
): Promise<{
  labelTypes: LabelType[];
  members: SettingsMember[];
  groupMappings: ProjectGroupMapping[];
}> {
  const { labelTypes, members } = await loadProjectRoster(db, projectId);
  const groupMappings = await loadGroupMappings(db, projectId);
  return { labelTypes, members, groupMappings };
}

/** Group mappings for the members settings tab. */
async function loadGroupMappings(
  db: DatabaseAdapter,
  projectId: string,
): Promise<ProjectGroupMapping[]> {
  return await new ProjectGroupMappingModel(db).list(projectId);
}

/** Channel summaries for the settings UI. */
async function loadNotificationChannels(
  db: DatabaseAdapter,
  secret: string | undefined,
  projectId: string,
): Promise<SettingsNotificationChannel[]> {
  const rows = await new NotificationChannelModel(db, undefined, secret).list(projectId);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    config: NotificationChannelModel.configOf(row),
    hasSecret: row.secretEncrypted !== null,
    events: NotificationChannelModel.eventsOf(row),
    enabled: row.enabled,
  }));
}

/** The viewer's own subscription for the settings UI (null when opted out). */
async function loadMySubscription(
  db: DatabaseAdapter,
  projectId: string,
  userId: string | undefined,
): Promise<SettingsMySubscription | null> {
  if (!userId) {
    return null;
  }
  const row = await new NotificationSubscriptionModel(db).getFor(projectId, userId);
  if (!row) {
    return null;
  }
  return {
    events: NotificationSubscriptionModel.eventsOf(row),
    via: NotificationSubscriptionModel.viaOf(row),
    enabled: row.enabled,
  };
}

/** Notification channels, providers, and my subscription for the UI. */
async function loadNotificationSection(
  db: DatabaseAdapter,
  secret: string | undefined,
  projectId: string,
  userId: string | undefined,
  notifiers: { metadata: { kind: string } }[],
): Promise<{
  notificationChannels: SettingsNotificationChannel[];
  notifyProviders: string[];
  mySubscription: SettingsMySubscription | null;
}> {
  const notificationChannels = await loadNotificationChannels(db, secret, projectId);
  const mySubscription = await loadMySubscription(db, projectId, userId);
  return {
    notificationChannels,
    notifyProviders: notifiers.map((candidate) => candidate.metadata.kind),
    mySubscription,
  };
}

/** Roster, tokens, webhooks, and status configs for the settings UI. */
async function loadInventorySection(
  db: DatabaseAdapter,
  secret: string | undefined,
  projectId: string,
): Promise<{
  labelTypes: LabelType[];
  members: SettingsMember[];
  groupMappings: ProjectGroupMapping[];
  tokens: Omit<Token, "hash">[];
  webhooks: SettingsWebhook[];
  statusConfigs: SettingsStatusConfig[];
}> {
  const { labelTypes, members, groupMappings } = await loadMembersSection(db, projectId);
  const tokens = await loadTokenSummaries(db, projectId);
  const webhooks = await loadWebhookSummaries(db, projectId);
  const statusConfigs = await loadStatusConfigSummaries(db, secret, projectId);
  return { labelTypes, members, groupMappings, tokens, webhooks, statusConfigs };
}

async function loadSettingsData(slug: string): Promise<SettingsData | null> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  if (!project) {
    return null;
  }
  const { db, config, user, authEnabled, gitHosts, notifiers } = getStore();
  const inventory = await loadInventorySection(db, config.secret, project.id);
  const notifications = await loadNotificationSection(
    db,
    config.secret,
    project.id,
    user?.id,
    notifiers,
  );
  const isAdmin = isProjectAdmin(authEnabled, user, inventory.members);
  return { project, ...inventory, ...notifications, gitHosts, isAdmin };
}

/** Render the project settings page for the given tab, optionally with form state. */
export async function renderSettingsPage(
  c: Context,
  tab: SettingsTab,
  formState?: SettingsFormState,
): Promise<string> {
  const slug = c.req.param("slug") ?? "";
  const data = await loadSettingsData(slug);
  if (!data) {
    notFound("Project not found");
  }
  return await renderProjectSettingsPage(
    {
      project: data.project,
      activeTab: tab,
      labelTypes: data.labelTypes,
      tokens: data.tokens,
      members: data.members,
      groupMappings: data.groupMappings,
      webhooks: data.webhooks,
      notificationChannels: data.notificationChannels,
      notifyProviders: data.notifyProviders,
      mySubscription: data.mySubscription,
      statusConfigs: data.statusConfigs,
      gitHosts: data.gitHosts,
      isAdmin: data.isAdmin,
    },
    formState,
  );
}

/** Find a project by slug or throw 404. */
export async function findProject(slug: string): Promise<Project> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  if (!project) {
    notFound("Project not found");
  }
  return project;
}

/** Trim a form value to a string, dropping files and blanks. */
export function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}
