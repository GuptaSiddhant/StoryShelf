import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { LabelType } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import { Tabs } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { renderSettingsGeneral } from "./settings-general.tsx";
import { renderSettingsLabels } from "./settings-labels.tsx";
import { renderSettingsMembers, type SettingsMember } from "./settings-members.tsx";
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
  | "members"
  | "status";

/** Data required to render the project settings page with its active tab. */
export interface ProjectSettingsData {
  project: Project;
  activeTab: SettingsTab;
  labelTypes: LabelType[];
  tokens: Omit<Token, "hash">[];
  members: SettingsMember[];
  groupMappings: ProjectGroupMapping[];
  webhooks: SettingsWebhook[];
  statusConfigs: SettingsStatusConfig[];
  gitHosts: GitHostProvider[];
  isAdmin: boolean;
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
  members: "Members",
  status: "Git status",
};

const SETTINGS_TABS: SettingsTab[] = [
  "general",
  "tests",
  "labels",
  "tokens",
  "webhooks",
  "members",
  "status",
];

function renderActiveTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  const { project, activeTab } = data;
  if (activeTab === "general") return renderSettingsGeneral(project, formState, data.isAdmin);
  if (activeTab === "tests") return renderSettingsTests(project, data.isAdmin, formState);
  if (activeTab === "labels") return renderSettingsLabels(project, data.labelTypes, data.isAdmin);
  if (activeTab === "tokens")
    return renderSettingsTokens(project, data.tokens, data.isAdmin, formState?.secret);
  if (activeTab === "webhooks")
    return renderSettingsWebhooks(project, data.webhooks, data.isAdmin, formState);
  if (activeTab === "members")
    return renderSettingsMembers(project, data.members, data.groupMappings, data.isAdmin);
  if (activeTab === "status")
    return renderSettingsStatus(project, data.statusConfigs, data.gitHosts, data.isAdmin);
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
      nav={{ active: "settings", projectSlug: project.slug, projectName: project.name }}
    >
      <div class="page-header">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/projects">Projects</a>
            </li>
            <li>
              <a href={`/projects/${project.slug}/builds`}>{project.name}</a>
            </li>
            <li>
              <span aria-current="page">Settings</span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">Project settings</h1>
            <p class="page-header__desc">
              Manage general settings, labels, tokens, webhooks and members for {project.name}.
            </p>
          </div>
        </div>
      </div>

      <Tabs
        label="Settings sections"
        tabs={SETTINGS_TABS.map((tab) => ({
          label: TAB_LABELS[tab],
          href: tabHref(project, tab),
          active: activeTab === tab,
        }))}
      />

      {renderActiveTab(data, formState)}
    </DocumentLayout>
  );
}
