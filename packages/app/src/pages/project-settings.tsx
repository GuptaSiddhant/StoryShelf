import type { RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import { readOwnerRules } from "@storyshelf/core/models";
import type { LabelType } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectGroupMapping } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import { getStore, testingEnabled } from "../store.ts";
import { PageHeader, Tabs, VStack } from "../ui/components.tsx";
import { renderSettingsAi, type SettingsAiData } from "./settings-ai.tsx";
import { renderSettingsCapture } from "./settings-capture.tsx";
import { ComponentOwnersCard } from "./settings-component-owners.tsx";
import { renderSettingsDesign, type SettingsDesignData } from "./settings-design.tsx";
import { renderSettingsGeneral } from "./settings-general.tsx";
import { renderSettingsInsights, type SettingsInsightsData } from "./settings-insights.tsx";
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
import { renderSettingsReview } from "./settings-review.tsx";
import {
  SETTINGS_TABS,
  TAB_LABELS,
  sectionsOf,
  type SettingsSection,
  type SettingsTab,
} from "./settings-tabs.ts";
import { renderSettingsTests } from "./settings-tests.tsx";
import { renderSettingsThresholds } from "./settings-thresholds.tsx";
import { renderSettingsTokens } from "./settings-tokens.tsx";
import { renderSettingsWebhooks, type SettingsWebhook } from "./settings-webhooks.tsx";

/** Data required to render the project settings page with its active tab. */
export interface ProjectSettingsData {
  project: Project;
  activeTab: SettingsTab;
  /** The section a refused form belongs to: it alone shows `formState`. */
  formSection?: SettingsSection | undefined;
  /** The Insights tab; omitted when nothing on it applies (hosting-only, no AI). */
  insights?: SettingsInsightsData | undefined;
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
  /** Notifiers are wired but no public origin resolves (ADR 0014, decision 11). */
  notificationsPaused?: boolean | undefined;
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
  /** Confirmed public origin, for the upload command shown with a new token. */
  origin?: string;
  /** Label type key whose edit form is open (labels tab). */
  editKey?: string;
  /** Members tab: a refused component-owners submission, shown again as typed. */
  ownerText?: string;
  ownerProblems?: { line: number; message: string }[];
}

/** Sections that are `testing` pages: hidden on a hosting-only instance. */
const TESTING_SECTIONS: ReadonlySet<SettingsSection> = new Set([
  "thresholds",
  "capture",
  "tests",
  "ai",
]);

/** A section shows when its page exists: `testing` sections need testing, and the AI section needs AI. */
function sectionShown(section: SettingsSection, data: ProjectSettingsData): boolean {
  if (TESTING_SECTIONS.has(section) && !testingEnabled()) {
    return false;
  }
  return section !== "ai" || data.ai?.available === true;
}

/** Whether the Insights tab has anything to show: capture numbers and jobs need testing, the digest needs AI. */
export function insightsShown(insights: SettingsInsightsData | undefined): boolean {
  return insights !== undefined && (insights.testing || insights.health !== null);
}

/** The tabs the bar offers: Insights only when it has content. */
export function shownTabs(data: ProjectSettingsData): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => tab !== "insights" || insightsShown(data.insights));
}

type SectionRenderer = (data: ProjectSettingsData, formState?: SettingsFormState) => unknown;

/** How each section renders; the Review & notifications sections are split off to stay readable. */
const REVIEW_SECTIONS: Partial<Record<SettingsSection, SectionRenderer>> = {
  review: (data, formState) => renderSettingsReview(data.project, formState, data.isAdmin),
  owners: (data, formState) => (
    <ComponentOwnersCard
      project={data.project}
      rules={readOwnerRules(data.project.componentOwners)}
      isAdmin={data.isAdmin}
      formState={formState}
    />
  ),
  labels: (data, formState) =>
    renderSettingsLabels(data.project, data.labelTypes, data.isAdmin, formState),
  notifications: (data, formState) =>
    renderSettingsNotifications(
      data.project,
      data.notificationChannels,
      data.notifyProviders,
      data.mySubscription,
      data.isAdmin,
      formState,
      data.notificationsPaused,
    ),
};

const SECTIONS: Partial<Record<SettingsSection, SectionRenderer>> = {
  ...REVIEW_SECTIONS,
  general: (data, formState) => renderSettingsGeneral(data.project, formState, data.isAdmin),
  links: (data, formState) =>
    renderSettingsLinks(data.project, data.links, data.linkCandidates, data.isAdmin, formState),
  thresholds: (data, formState) => renderSettingsThresholds(data.project, formState, data.isAdmin),
  capture: (data, formState) =>
    renderSettingsCapture(data.project, data.isAdmin, formState, data.targets),
  tests: (data, formState) => renderSettingsTests(data.project, data.isAdmin, formState),
  ai: (data, formState) => renderSettingsAi(data.project, data.ai, formState),
  design: (data, formState) =>
    renderSettingsDesign(data.project, data.design, data.isAdmin, formState),
  members: (data, formState) =>
    renderSettingsMembers(data.project, data.members, data.groupMappings, data.isAdmin, formState),
  tokens: (data, formState) =>
    renderSettingsTokens(data.project, data.tokens, data.isAdmin, formState),
  webhooks: (data, formState) =>
    renderSettingsWebhooks(data.project, data.webhooks, data.isAdmin, formState),
  insights: (data) => (data.insights ? renderSettingsInsights(data.project, data.insights) : null),
};

function sectionBody(
  section: SettingsSection,
  data: ProjectSettingsData,
  formState?: SettingsFormState,
): unknown {
  return SECTIONS[section]?.(data, formState) ?? null;
}

/** The sections of the active tab, each under its own anchor; a refused form shows only on its section. */
function renderActiveTab(data: ProjectSettingsData, formState?: SettingsFormState): unknown {
  return (
    <VStack>
      {sectionsOf(data.activeTab)
        .filter((section) => sectionShown(section, data))
        .map((section) => (
          <div id={section}>
            {sectionBody(section, data, data.formSection === section ? formState : undefined)}
          </div>
        ))}
    </VStack>
  );
}

/** Project settings: grouped tabs across the top (the tab is in the URL) and the active tab's sections. */
export function renderProjectSettingsPage(
  data: ProjectSettingsData,
  formState?: SettingsFormState,
): RenderedContent {
  const { project, activeTab } = data;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
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
        description={<>Settings, access and insights for {project.name}.</>}
      />
      <Tabs
        label="Settings sections"
        tabs={shownTabs(data).map((tab) => ({
          label: TAB_LABELS[tab],
          href: urls.settingsTab(project.slug, tab),
          active: activeTab === tab,
        }))}
      />
      {renderActiveTab(data, formState)}
    </DocumentLayout>
  );
}

export type { SettingsSection, SettingsTab };
