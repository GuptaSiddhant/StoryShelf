// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta, StoryObj } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { renderProjectSettingsPage, type ProjectSettingsData } from "./project-settings.tsx";
import type {
  SettingsMySubscription,
  SettingsNotificationChannel,
  SettingsNotifyProvider,
} from "./settings-notifications.tsx";

const meta: Meta = { title: "Pages/Settings/Notifications" };
export default meta;

const providers: SettingsNotifyProvider[] = [
  { kind: "slack", name: "Slack", delivery: "message" },
  { kind: "email", name: "Email", delivery: "message" },
  { kind: "github", name: "GitHub", delivery: "state" },
];

/** Providers when no email transport is wired: only the chat webhook and the git host remain. */
const providersWithoutEmail = providers.filter((provider) => provider.kind !== "email");

const channels: SettingsNotificationChannel[] = [
  {
    id: "01JD000000000000000000CHN001",
    provider: "slack",
    delivery: "message",
    config: {},
    hasSecret: true,
    events: ["build:reviewing", "build:failed"],
    enabled: true,
    lastError: null,
    lastErrorAt: null,
  },
  {
    id: "01JD000000000000000000CHN002",
    provider: "email",
    delivery: "message",
    config: { to: "design-team@example.com" },
    hasSecret: false,
    events: [],
    enabled: true,
    lastError: "SMTP 550: mailbox unavailable",
    lastErrorAt: "2026-01-15T07:30:00.000Z",
  },
  {
    id: "01JD000000000000000000CHN003",
    provider: "github",
    delivery: "state",
    config: { owner: "acme", repo: "design-system", prefix: "StoryShelf" },
    hasSecret: true,
    events: [],
    enabled: true,
    lastError: null,
    lastErrorAt: null,
  },
];

const subscribed: SettingsMySubscription = {
  events: ["build:reviewing", "build:approved", "comment:created"],
  via: ["email"],
  enabled: true,
};

const optedOut: SettingsMySubscription = { events: [], via: [], enabled: false };

/** The project settings page on its Notifications tab: only the notification data differs per story. */
const settingsPage = (
  data: Pick<
    ProjectSettingsData,
    "notificationChannels" | "notifyProviders" | "mySubscription" | "isAdmin"
  >,
): RenderedContent =>
  renderProjectSettingsPage({
    project,
    activeTab: "notifications",
    labelTypes: [],
    links: [],
    linkCandidates: [],
    design: { files: [], components: [], providers: [] },
    tokens: [],
    members: [],
    groupMappings: [],
    webhooks: [],
    ...data,
  });

/** No channels and no subscription: the empty state of a new project. */
export const NoSubscriptions = pageStory(() =>
  settingsPage({
    notificationChannels: [],
    notifyProviders: providers,
    mySubscription: null,
    isAdmin: true,
  }),
);

/** The viewer follows a few topics by email; channels list one that is failing. */
export const Subscribed = pageStory(() =>
  settingsPage({
    notificationChannels: channels,
    notifyProviders: providers,
    mySubscription: subscribed,
    isAdmin: true,
  }),
);

/** The viewer has a saved subscription with email switched off. */
export const OptedOut = pageStory(() =>
  settingsPage({
    notificationChannels: channels,
    notifyProviders: providers,
    mySubscription: optedOut,
    isAdmin: true,
  }),
);

/** No email transport is wired: the create-channel form offers the chat webhook only. */
export const EmailOff = pageStory(() =>
  settingsPage({
    notificationChannels: channels.filter((channel) => channel.provider !== "email"),
    notifyProviders: providersWithoutEmail,
    mySubscription: subscribed,
    isAdmin: true,
  }),
);

/** The Channels table on a 375px phone: the page must not scroll sideways, the table scrolls in its own region. */
export const OnAPhone: StoryObj = {
  ...pageStory(() =>
    settingsPage({
      notificationChannels: channels,
      notifyProviders: providers,
      mySubscription: subscribed,
      isAdmin: true,
    }),
  ),
  globals: { viewport: { value: "phone", isRotated: false } },
};
