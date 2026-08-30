import type { GitProvider } from "../adapters/status.ts";
import type { LabelType, Project, Token } from "../schema.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { renderSettingsGeneral } from "./settings-general.tsx";
import { renderSettingsLabels } from "./settings-labels.tsx";
import { renderSettingsMembers, type SettingsMember } from "./settings-members.tsx";
import { renderSettingsStatus, type SettingsStatusConfig } from "./settings-status.tsx";
import { renderSettingsTokens } from "./settings-tokens.tsx";
import { renderSettingsWebhooks, type SettingsWebhook } from "./settings-webhooks.tsx";

export type SettingsTab = "general" | "labels" | "tokens" | "webhooks" | "members" | "status";

export interface ProjectSettingsData {
  project: Project;
  activeTab: SettingsTab;
  labelTypes: LabelType[];
  tokens: Array<Omit<Token, "hash">>;
  members: SettingsMember[];
  webhooks: SettingsWebhook[];
  statusConfigs: SettingsStatusConfig[];
  gitProviders: GitProvider[];
  isAdmin: boolean;
}

export interface SettingsFormState {
  errors?: Record<string, string>;
  globalError?: string;
  secret?: string;
}

export function renderProjectSettingsPage(data: ProjectSettingsData, formState?: SettingsFormState): RenderedContent {
  const { project, activeTab } = data;
  return (
    <DocumentLayout title={`${project.name} · Settings`} nav={{ active: "settings", projectSlug: project.slug, projectName: project.name }}>
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
            <p class="page-header__desc">Manage general settings, labels, tokens, webhooks and members for {project.name}.</p>
          </div>
        </div>
      </div>

      <nav class="tabs" aria-label="Settings sections">
        <a class={`tabs__link ${activeTab === "general" ? "tabs__link--active" : ""}`} href={`/projects/${project.slug}/settings`} aria-current={activeTab === "general" ? "page" : undefined}>
          General
        </a>
        <a class={`tabs__link ${activeTab === "labels" ? "tabs__link--active" : ""}`} href={`/projects/${project.slug}/settings/labels`} aria-current={activeTab === "labels" ? "page" : undefined}>
          Labels
        </a>
        <a class={`tabs__link ${activeTab === "tokens" ? "tabs__link--active" : ""}`} href={`/projects/${project.slug}/settings/tokens`} aria-current={activeTab === "tokens" ? "page" : undefined}>
          Tokens
        </a>
        <a class={`tabs__link ${activeTab === "webhooks" ? "tabs__link--active" : ""}`} href={`/projects/${project.slug}/settings/webhooks`} aria-current={activeTab === "webhooks" ? "page" : undefined}>
          Webhooks
        </a>
        <a class={`tabs__link ${activeTab === "members" ? "tabs__link--active" : ""}`} href={`/projects/${project.slug}/settings/members`} aria-current={activeTab === "members" ? "page" : undefined}>
          Members
        </a>
        <a class={`tabs__link ${activeTab === "status" ? "tabs__link--active" : ""}`} href={`/projects/${project.slug}/settings/status`} aria-current={activeTab === "status" ? "page" : undefined}>
          Git status
        </a>
      </nav>

      {activeTab === "general" ? renderSettingsGeneral(project, formState, data.isAdmin) : null}
      {activeTab === "labels" ? renderSettingsLabels(project, data.labelTypes, data.isAdmin) : null}
      {activeTab === "tokens" ? renderSettingsTokens(project, data.tokens, data.isAdmin) : null}
      {activeTab === "webhooks" ? renderSettingsWebhooks(project, data.webhooks, data.isAdmin, formState) : null}
      {activeTab === "members" ? renderSettingsMembers(project, data.members, data.isAdmin) : null}
      {activeTab === "status" ? renderSettingsStatus(project, data.statusConfigs, data.gitProviders, data.isAdmin) : null}
    </DocumentLayout>
  );
}