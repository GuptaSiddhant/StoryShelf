import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { LabelType } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import { PageHeader, SubNavLayout } from "../ui/components.tsx";
import type { IconName } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { renderSettingsAi, type SettingsAiData } from "./settings-ai.tsx";
import { renderSettingsGeneral } from "./settings-general.tsx";
import { renderSettingsLabels } from "./settings-labels.tsx";
import { renderSettingsMembers, type SettingsMember } from "./settings-members.tsx";
import {
  renderSettingsNotifications,
  type SettingsMySubscription,
  type SettingsNotificationChannel,
} from "./settings-notifications.tsx";
import { renderSettingsStatus, type SettingsStatusConfig } from "./settings-status.tsx";
import { renderSettingsTests } from "./settings-tests.tsx";
import { renderSettingsTokens } from "./settings-tokens.tsx";
import { renderSettingsWebhooks, type SettingsWebhook } from "./settings-webhooks.tsx";

/** Tabs available in the project settings section. */
export type SettingsTab =
  | "general"
  | "tests"
  | "labels"
  | "tokens"
  | "webhooks"
  | "notifications"
  | "members"
  | "status"
  | "ai";

/** Data required to render the project settings page with its active tab. */
export interface ProjectSettingsData {
  project: Project;
  activeTab: SettingsTab;
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
  /** AI availability and the profile choices (omitted ⇒ AI off). */
  ai?: SettingsAiData;
}

/** Form state shared by the settings tabs (field errors, global error, one-time secret). */
export interface SettingsFormState {
  errors?: Record<string, string>;
  globalError?: string;
  secret?: string;
}

function tabHref(project: Project, tab: SettingsTab): string {
  return tab === "general"
    ? `/projects/${project.slug}/settings`
    : `/projects/${project.slug}/settings/${tab}`;
}

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  tests: "Tests",
  labels: "Labels",
  tokens: "Tokens",
  webhooks: "Webhooks",
  notifications: "Notifications",
  members: "Members",
  status: "Git status",
  ai: "AI",
};

const TAB_ICONS: Record<SettingsTab, IconName> = {
  general: "settings",
  tests: "activity",
  labels: "tag",
  tokens: "key",
  webhooks: "webhook",
  notifications: "bell",
  members: "users",
  status: "git-branch",
  ai: "sparkles",
};

const SETTINGS_TABS: SettingsTab[] = [
  "general",
  "tests",
  "labels",
  "tokens",
  "webhooks",
  "notifications",
  "members",
  "status",
  "ai",
];

/** Project-behaviour tabs (general, tests, AI); undefined for any other tab. */
function renderBehaviourTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  const { project, activeTab } = data;
  if (activeTab === "general") return renderSettingsGeneral(project, formState, data.isAdmin);
  if (activeTab === "ai") return renderSettingsAi(project, data.ai, formState);
  return activeTab === "tests" ? renderSettingsTests(project, data.isAdmin, formState) : undefined;
}

function renderActiveTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  const { project, activeTab } = data;
  const behaviour = renderBehaviourTab(data, formState);
  if (behaviour !== undefined) return behaviour;
  if (activeTab === "labels")
    return renderSettingsLabels(project, data.labelTypes, data.isAdmin, formState);
  if (activeTab === "tokens")
    return renderSettingsTokens(project, data.tokens, data.isAdmin, formState);
  if (activeTab === "webhooks")
    return renderSettingsWebhooks(project, data.webhooks, data.isAdmin, formState);
  if (activeTab === "notifications")
    return renderSettingsNotifications(
      project,
      data.notificationChannels,
      data.notifyProviders,
      data.mySubscription,
      data.isAdmin,
      formState,
    );
  if (activeTab === "members")
    return renderSettingsMembers(
      project,
      data.members,
      data.groupMappings,
      data.isAdmin,
      formState,
    );
  if (activeTab === "status")
    return renderSettingsStatus(
      project,
      data.statusConfigs,
      data.gitHosts,
      data.isAdmin,
      formState,
    );
  return null;
}

/** Project settings shell: tab navigation plus the active settings tab. */
export function renderProjectSettingsPage(
  data: ProjectSettingsData,
  formState?: SettingsFormState,
): RenderedContent {
  const { project, activeTab } = data;
  return (
    <DocumentLayout
      title={`${project.name} · Settings`}
      nav={{
        active: "settings",
        projectSlug: project.slug,
        projectName: project.name,
        trail: activeTab === "general" ? [] : [{ label: TAB_LABELS[activeTab] }],
      }}
    >
      <PageHeader
        title="Project settings"
        description={
          <>Manage general settings, labels, tokens, webhooks and members for {project.name}.</>
        }
      />

      <SubNavLayout
        label="Settings sections"
        items={SETTINGS_TABS.filter((tab) => tab !== "ai" || data.ai?.available).map((tab) => ({
          label: TAB_LABELS[tab],
          href: tabHref(project, tab),
          icon: TAB_ICONS[tab],
          active: activeTab === tab,
        }))}
      >
        {renderActiveTab(data, formState)}
      </SubNavLayout>
    </DocumentLayout>
  );
}
