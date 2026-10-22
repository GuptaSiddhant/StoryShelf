import type { RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import type { LabelType } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import { testingEnabled } from "../store.ts";
import { PageHeader, SubNavLayout } from "../ui/components.tsx";
import type { IconName } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { renderSettingsAi, type SettingsAiData } from "./settings-ai.tsx";
import { renderSettingsCapture } from "./settings-capture.tsx";
import { renderSettingsDesign, type SettingsDesignData } from "./settings-design.tsx";
import { renderSettingsGeneral } from "./settings-general.tsx";
import { renderSettingsLabels } from "./settings-labels.tsx";
import {
  renderSettingsLinks,
  type SettingsLink,
  type SettingsLinkCandidate,
} from "./settings-links.tsx";
import { renderSettingsMembers, type SettingsMember } from "./settings-members.tsx";
import {
  renderSettingsNotifications,
  type SettingsMySubscription,
  type SettingsNotificationChannel,
  type SettingsNotifyProvider,
} from "./settings-notifications.tsx";
import { renderSettingsTests } from "./settings-tests.tsx";
import { renderSettingsTokens } from "./settings-tokens.tsx";
import { renderSettingsWebhooks, type SettingsWebhook } from "./settings-webhooks.tsx";

/** Tabs available in the project settings section. */
export type SettingsTab =
  | "general"
  | "capture"
  | "tests"
  | "labels"
  | "links"
  | "design"
  | "tokens"
  | "webhooks"
  | "notifications"
  | "members"
  | "ai";

/** Data required to render the project settings page with its active tab. */
export interface ProjectSettingsData {
  project: Project;
  activeTab: SettingsTab;
  labelTypes: LabelType[];
  links: SettingsLink[];
  linkCandidates: SettingsLinkCandidate[];
  design: SettingsDesignData;
  tokens: Omit<Token, "hash">[];
  members: SettingsMember[];
  groupMappings: ProjectGroupMapping[];
  webhooks: SettingsWebhook[];
  notificationChannels: SettingsNotificationChannel[];
  notifyProviders: SettingsNotifyProvider[];
  mySubscription: SettingsMySubscription | null;
  isAdmin: boolean;
  /** AI availability and the profile choices (omitted ⇒ AI off). */
  ai?: SettingsAiData;
  /** What the capture runner offers (ADR 0007); omitted when it publishes no list. */
  targets?: readonly RunnerTarget[] | undefined;
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
  capture: "Capture",
  tests: "Tests",
  labels: "Labels",
  links: "Links",
  design: "Design",
  tokens: "Tokens",
  webhooks: "Webhooks",
  notifications: "Notifications",
  members: "Members",
  ai: "AI",
};

const TAB_ICONS: Record<SettingsTab, IconName> = {
  general: "settings",
  capture: "image",
  tests: "activity",
  labels: "tag",
  links: "external-link",
  design: "image",
  tokens: "key",
  webhooks: "webhook",
  notifications: "bell",
  members: "users",
  ai: "sparkles",
};

/** Tabs whose pages are `testing` routes: hidden on a hosting-only instance. */
const TESTING_TABS: ReadonlySet<SettingsTab> = new Set(["capture", "tests", "ai"]);

const SETTINGS_TABS: SettingsTab[] = [
  "general",
  "capture",
  "tests",
  "labels",
  "links",
  "design",
  "tokens",
  "webhooks",
  "notifications",
  "members",
  "ai",
];

/** A tab shows when its page exists: `testing` tabs need testing, and the AI tab needs AI. */
function settingsTabShown(tab: SettingsTab, data: ProjectSettingsData): boolean {
  if (TESTING_TABS.has(tab) && !testingEnabled()) {
    return false;
  }
  return tab !== "ai" || data.ai?.available === true;
}

/** Project-behaviour tabs (general, tests, AI); undefined for any other tab. */
function renderBehaviourTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  const { project, activeTab } = data;
  if (activeTab === "general")
    return renderSettingsGeneral(project, formState, data.isAdmin, data.targets);
  if (activeTab === "capture")
    return renderSettingsCapture(project, data.isAdmin, formState, data.targets);
  if (activeTab === "ai") return renderSettingsAi(project, data.ai, formState);
  return activeTab === "tests" ? renderSettingsTests(project, data.isAdmin, formState) : undefined;
}

/** Labels, links, tokens, and webhooks tabs; undefined for any other tab. */
function renderCatalogTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  const { project, activeTab, isAdmin } = data;
  if (activeTab === "labels")
    return renderSettingsLabels(project, data.labelTypes, isAdmin, formState);
  if (activeTab === "links")
    return renderSettingsLinks(project, data.links, data.linkCandidates, isAdmin, formState);
  if (activeTab === "design") return renderSettingsDesign(project, data.design, isAdmin, formState);
  if (activeTab === "tokens") return renderSettingsTokens(project, data.tokens, isAdmin, formState);
  return activeTab === "webhooks"
    ? renderSettingsWebhooks(project, data.webhooks, isAdmin, formState)
    : undefined;
}

function renderActiveTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  const { project, activeTab } = data;
  const behaviour = renderBehaviourTab(data, formState);
  if (behaviour !== undefined) return behaviour;
  const catalog = renderCatalogTab(data, formState);
  if (catalog !== undefined) return catalog;
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
        items={SETTINGS_TABS.filter((tab) => settingsTabShown(tab, data)).map((tab) => ({
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
