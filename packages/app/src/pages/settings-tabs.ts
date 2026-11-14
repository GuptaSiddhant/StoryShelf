import { createUrlBuilder } from "@storyshelf/core/urls";

/** The tabs of the project settings page and the sections that live on each (issue #807). */

/** A tab of the project settings: the URL is `/projects/:slug/settings/<tab>`. */
export type SettingsTab = "general" | "capture" | "review" | "access" | "insights";

/** One block of settings; a tab stacks several. Most were a tab of their own before the grouping. */
export type SettingsSection =
  | "general"
  | "links"
  | "thresholds"
  | "capture"
  | "tests"
  | "ai"
  | "design"
  | "review"
  | "owners"
  | "labels"
  | "notifications"
  | "members"
  | "tokens"
  | "webhooks"
  | "insights";

/** The tabs in the order the bar shows them. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  "general",
  "capture",
  "review",
  "access",
  "insights",
];

/** The tab bar label of each tab. */
export const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  capture: "Capture & tests",
  review: "Review & notifications",
  access: "Access",
  insights: "Insights",
};

/** Which tab renders each section. */
export const SECTION_TAB: Record<SettingsSection, SettingsTab> = {
  general: "general",
  links: "general",
  thresholds: "capture",
  capture: "capture",
  tests: "capture",
  ai: "capture",
  design: "capture",
  review: "review",
  owners: "review",
  labels: "review",
  notifications: "review",
  members: "access",
  tokens: "access",
  webhooks: "access",
  insights: "insights",
};

/** The sections of a tab, top to bottom. */
export function sectionsOf(tab: SettingsTab): SettingsSection[] {
  return (Object.keys(SECTION_TAB) as SettingsSection[]).filter(
    (section) => SECTION_TAB[section] === tab,
  );
}

/** Narrow a URL segment to a tab. */
export function isSettingsTab(value: string): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value);
}

/**
 * Settings pages that used to have a URL of their own (`/settings/labels`, `/settings/tokens`, …):
 * each now redirects to the tab that holds it. The tab names themselves are not listed.
 */
export const MOVED_SECTIONS = [
  "tests",
  "ai",
  "design",
  "links",
  "labels",
  "notifications",
  "members",
  "tokens",
  "webhooks",
] as const satisfies readonly SettingsSection[];

/** A section that used to be a page of its own, or undefined for a tab name or anything else. */
export function movedSection(value: string): SettingsSection | undefined {
  return (MOVED_SECTIONS as readonly string[]).includes(value)
    ? (value as SettingsSection)
    : undefined;
}

/** Where a section lives: its tab's URL, with the section as the anchor (`/settings/review#labels`). */
export function settingsHref(slug: string, section: SettingsSection, query = ""): string {
  const tab = createUrlBuilder("/").settingsTab(slug, SECTION_TAB[section]);
  return `${tab}${query}#${section}`;
}
