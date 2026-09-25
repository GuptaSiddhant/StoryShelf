import type { AuthUser } from "@storyshelf/core/adapter/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import { LabelModel } from "@storyshelf/core/models";
import { MemberModel } from "@storyshelf/core/models";
import { ProjectGroupMappingModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { StatusConfigModel } from "@storyshelf/core/models";
import { TokenModel } from "@storyshelf/core/models";
import { WebhookModel } from "@storyshelf/core/models";
import type { LabelType } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import type { Context } from "hono";
import {
  renderProjectSettingsPage,
  type SettingsFormState,
  type SettingsTab,
} from "../pages/project-settings.tsx";
import type { SettingsMember } from "../pages/settings-members.tsx";
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
  statusConfigs: SettingsStatusConfig[];
  gitHosts: GitHostProvider[];
  isAdmin: boolean;
}

/** Tokens without hashes for the settings UI. */
async function loadTokenSummaries(
  db: DatabaseAdapter,
  projectId: string,
): Promise<Omit<Token, "hash">[]> {
  const tokensDb = await new TokenModel(db, { tokens: getStore().db.tables.tokens }).list(
    projectId,
  );
  return tokensDb.map(({ hash: _hash, ...rest }) => rest);
}

/** Webhook summaries for the settings UI. */
async function loadWebhookSummaries(
  db: DatabaseAdapter,
  projectId: string,
): Promise<SettingsWebhook[]> {
  const webhooksDb = await new WebhookModel(db, { webhooks: getStore().db.tables.webhooks }).list(
    projectId,
  );
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
  const statusConfigsDb = await new StatusConfigModel(
    db,
    { projectStatusConfigs: getStore().db.tables.projectStatusConfigs },
    secret,
  ).list(projectId);
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
  const labelTypes = await new LabelModel(db, {
    builds: getStore().db.tables.builds,
    buildLabels: getStore().db.tables.buildLabels,
    labelTypes: getStore().db.tables.labelTypes,
  }).listTypes(projectId);
  const members = await new MemberModel(db, {
    projectMembers: getStore().db.tables.projectMembers,
  }).list(projectId);
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
  return await new ProjectGroupMappingModel(db, {
    projectGroupMappings: getStore().db.tables.projectGroupMappings,
  }).list(projectId);
}

async function loadSettingsData(slug: string): Promise<SettingsData | null> {
  const project = await new ProjectModel(getStore().db, {
    projects: getStore().db.tables.projects,
  }).getBySlug(slug);
  if (!project) {
    return null;
  }
  const { db, config, user, authEnabled, gitHosts } = getStore();
  const { labelTypes, members, groupMappings } = await loadMembersSection(db, project.id);
  const tokens = await loadTokenSummaries(db, project.id);
  const webhooks = await loadWebhookSummaries(db, project.id);
  const statusConfigs = await loadStatusConfigSummaries(db, config.secret, project.id);
  const isAdmin = isProjectAdmin(authEnabled, user, members);
  return {
    project,
    labelTypes,
    tokens,
    members,
    groupMappings,
    webhooks,
    statusConfigs,
    gitHosts,
    isAdmin,
  };
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
      statusConfigs: data.statusConfigs,
      gitHosts: data.gitHosts,
      isAdmin: data.isAdmin,
    },
    formState,
  );
}

/** Find a project by slug or throw 404. */
export async function findProject(slug: string): Promise<Project> {
  const project = await new ProjectModel(getStore().db, {
    projects: getStore().db.tables.projects,
  }).getBySlug(slug);
  if (!project) {
    notFound("Project not found");
  }
  return project;
}

/** Trim a form value to a string, dropping files and blanks. */
export function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}
