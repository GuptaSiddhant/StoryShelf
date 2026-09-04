import type { GitHostProvider } from "../adapters/git-host/index.ts";
import type { LabelType, Project, Token } from "../schema.ts";
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

function renderTabLink(
  project: Project,
  activeTab: SettingsTab,
  tab: SettingsTab,
  label: string,
): unknown {
  const active = activeTab === tab;
  return (
    <a
      class={`tabs__link ${active ? "tabs__link--active" : ""}`}
      href={tabHref(project, tab)}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </a>
  );
}

function renderActiveTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  const { project, activeTab } = data;
  if (activeTab === "general") return renderSettingsGeneral(project, formState, data.isAdmin);
  if (activeTab === "tests") return renderSettingsTests(project, data.isAdmin, formState);
  if (activeTab === "labels") return renderSettingsLabels(project, data.labelTypes, data.isAdmin);
  if (activeTab === "tokens") return renderSettingsTokens(project, data.tokens, data.isAdmin);
  if (activeTab === "webhooks")
    return renderSettingsWebhooks(project, data.webhooks, data.isAdmin, formState);
  if (activeTab === "members") return renderSettingsMembers(project, data.members, data.isAdmin);
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

      <nav class="tabs" aria-label="Settings sections">
        {renderTabLink(project, activeTab, "general", "General")}
        {renderTabLink(project, activeTab, "tests", "Tests")}
        {renderTabLink(project, activeTab, "labels", "Labels")}
        {renderTabLink(project, activeTab, "tokens", "Tokens")}
        {renderTabLink(project, activeTab, "webhooks", "Webhooks")}
        {renderTabLink(project, activeTab, "members", "Members")}
        {renderTabLink(project, activeTab, "status", "Git status")}
      </nav>

      {renderActiveTab(data, formState)}
    </DocumentLayout>
  );
}
