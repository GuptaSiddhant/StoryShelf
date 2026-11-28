// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import { renderProjectSettingsPage, type ProjectSettingsData } from "./project-settings.tsx";
import type { SettingsTab } from "./settings-tabs.ts";

const meta: Meta = { title: "Pages/Settings/Summaries" };
export default meta;

const page = (tab: SettingsTab, changes: Partial<ProjectSettingsData>): RenderedContent =>
  renderProjectSettingsPage({
    project,
    activeTab: tab,
    labelTypes: [],
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

const providers = [
  { kind: "email", name: "Email", delivery: "message" as const },
  { kind: "slack-webhook", name: "Slack", delivery: "message" as const },
];

const channel = (
  id: string,
  provider: string,
  changes: Partial<NonNullable<ProjectSettingsData["notificationChannels"][number]>> = {},
): ProjectSettingsData["notificationChannels"][number] => ({
  id,
  provider,
  delivery: "message",
  config: provider === "email" ? { to: "team@example.com" } : {},
  hasSecret: provider !== "email",
  events: [],
  enabled: true,
  lastError: null,
  lastErrorAt: null,
  lastDeliveredAt: null,
  ...changes,
});

const accessMembers = [
  {
    id: "m1",
    projectId: project.id,
    userId: "ana-id",
    role: "admin",
    createdAt: hoursAgo(900),
    name: "Ana Rivera",
    email: "ana@example.com",
  },
  {
    id: "m2",
    projectId: project.id,
    userId: "li-id",
    role: "viewer",
    createdAt: hoursAgo(300),
    name: "li@example.com",
    email: "li@example.com",
  },
];

const accessTokens = [
  {
    id: "t1",
    projectId: project.id,
    name: "ci",
    userId: null,
    createdAt: hoursAgo(500),
    lastUsedAt: hoursAgo(5),
  },
  {
    id: "t2",
    projectId: project.id,
    name: "release",
    userId: null,
    createdAt: hoursAgo(100),
    lastUsedAt: null,
  },
] as ProjectSettingsData["tokens"];

/** Webhook URLs reach the page already masked (`maskUrlForDisplay`, #1473): origin and a short tail. */
const accessWebhooks = [
  { id: "w1", url: "https://hooks.slack.com/…/9xQz", events: [] },
  { id: "w2", url: "https://ci.example.com/…", events: ["build.approved", "build.rejected"] },
];

/** Access with members, group mappings, tokens and webhooks listed. */
export const AccessList = pageStory(() =>
  page("access", {
    members: accessMembers,
    groupMappings: [
      {
        id: "g1",
        projectId: project.id,
        groupName: "team-design",
        role: "developer",
        createdAt: hoursAgo(200),
      },
    ],
    tokens: accessTokens,
    webhooks: accessWebhooks,
  }),
);

/** A member whose account row is gone: the roster says so, never the user id. */
export const AccessMemberUnknown = pageStory(() =>
  page("access", {
    members: [
      {
        id: "m3",
        projectId: project.id,
        userId: "deleted-user-id",
        role: "viewer",
        createdAt: hoursAgo(120),
        name: "Unknown user",
        email: null,
      },
    ],
  }),
);

/** Access when nothing is configured: each list shows its empty state with the Add action. */
export const AccessEmpty = pageStory(() => page("access", {}));

/** Access for a member who is not an admin: no Add, Edit or Remove. */
export const AccessNotAdmin = pageStory(() =>
  page("access", {
    isAdmin: false,
    members: [
      {
        id: "m1",
        projectId: project.id,
        userId: "ana-id",
        role: "admin",
        createdAt: hoursAgo(900),
        name: "Ana Rivera",
        email: "ana@example.com",
      },
    ],
  }),
);

/**
 * A Viewer gets the roster and nothing else on Access, even if the data held tokens and webhooks:
 * the tokens and webhooks sections are admin-only (#1473), so neither renders.
 */
export const AccessViewerSeesNoTokensOrWebhooks = pageStory(() =>
  page("access", {
    isAdmin: false,
    members: accessMembers,
    tokens: accessTokens,
    webhooks: accessWebhooks,
  }),
);

/** Review & notifications with a healthy, a failing and a never-delivered channel. */
export const NotificationsList = pageStory(() =>
  page("review", {
    notifyProviders: providers,
    notificationChannels: [
      channel("c1", "email", { lastDeliveredAt: hoursAgo(3) }),
      channel("c2", "slack-webhook", {
        lastError: "HTTP 404",
        lastErrorAt: hoursAgo(2),
        events: ["build.approved"],
      }),
      channel("c3", "slack-webhook"),
    ],
  }),
);

/** Review & notifications with no channel yet. */
export const NotificationsEmpty = pageStory(() => page("review", { notifyProviders: providers }));

/** General for a site admin: the project as a summary with Edit, and the danger zone. */
export const GeneralSummary = pageStory(() => page("general", { canDeleteProject: true }));

/** General for a project admin who is not a site admin: Edit, but no danger zone. */
export const GeneralProjectAdmin = pageStory(() => page("general", {}));

/** General for a member who is not an admin: the summary alone. */
export const GeneralNotAdmin = pageStory(() => page("general", { isAdmin: false }));
