// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { renderProjectSettingsPage, type ProjectSettingsData } from "./project-settings.tsx";
import type { SettingsTab } from "./settings-tabs.ts";

const meta: Meta = { title: "Pages/Settings/Tabs" };
export default meta;

/** The settings page on one tab; the Insights tab has its own stories. */
const tabPage = (tab: SettingsTab, changes: Partial<ProjectSettingsData> = {}): RenderedContent =>
  renderProjectSettingsPage({
    project,
    activeTab: tab,
    labelTypes: [
      { id: "lbl1", projectId: project.id, key: "branch", name: "Branch", linkTemplate: null },
      {
        id: "lbl2",
        projectId: project.id,
        key: "jira",
        name: "Jira",
        linkTemplate: "https://jira.example.com/browse/{value}",
      },
    ] as ProjectSettingsData["labelTypes"],
    links: [],
    linkCandidates: [],
    design: { files: [], components: [], providers: [] },
    tokens: [],
    members: [],
    groupMappings: [],
    webhooks: [],
    notificationChannels: [],
    notifyProviders: [],
    mySubscription: null,
    isAdmin: true,
    ...changes,
  });

/** General: name, repository, default branch and public branch regex, the package links and the danger zone. */
export const General = pageStory(() => tabPage("general"));

/** Capture & tests: thresholds, browsers, the test switches and design links. */
export const CaptureAndTests = pageStory(() => tabPage("capture"));

/** Capture & tests on a hosting-only server: only the design links remain. */
export const CaptureHostingOnly = pageStory(() => tabPage("capture"), {
  store: { testing: false },
});

/** Review & notifications: the review switch and approvals, component owners, labels and notifications. */
export const ReviewAndNotifications = pageStory(() => tabPage("review"));

/** Access: members, API tokens and webhooks. */
export const Access = pageStory(() => tabPage("access"));

/** A member who is not an admin sees every tab but cannot save. */
export const NotAdmin = pageStory(() => tabPage("capture", { isAdmin: false }));

/** The tab bar and a tab on a 375px phone: the bar scrolls sideways inside itself, the page does not. */
export const OnAPhone = onAPhone(pageStory(() => tabPage("access")));
