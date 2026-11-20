// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { HealthReport } from "../routers/health-report.ts";
import type { IntegrationsView } from "./admin-system-integrations.tsx";
import { renderAdminSystemPage, type AdminSystemData } from "./admin-system.tsx";

const meta: Meta = { title: "Pages/Admin/System" };
export default meta;

const report = (status: HealthReport["status"], failing = false): HealthReport => ({
  status,
  uptimeSecs: 273_600,
  version: "0.8.0",
  adapters: [
    {
      category: "database",
      kind: "sqlite",
      name: "SQLite",
      version: "0.8.0",
      hasLifecycle: true,
      state: failing ? "failed" : "ok",
      latencyMs: 2,
      ...(failing ? { detail: "database is locked" } : {}),
    },
    {
      category: "storage",
      kind: "local",
      name: "Local disk",
      version: "0.8.0",
      hasLifecycle: false,
      state: "ok",
    },
    {
      category: "runner",
      kind: "playwright",
      name: "Playwright",
      version: "0.8.0",
      hasLifecycle: true,
      state: status === "starting" ? "starting" : "ok",
    },
  ],
});

const data = (overrides: Partial<AdminSystemData> = {}): AdminSystemData => ({
  report: report("ok"),
  authEnabled: true,
  config: {
    purgeTtlDays: 90,
    branchTtlDays: 30,
    publishedBaseDomain: "shelf.example.com",
    maxUploadBytes: 524_288_000,
  },
  authMethods: ["Password", "GitHub"],
  testing: true,
  ...overrides,
});

export const Healthy = pageStory(() => renderAdminSystemPage(data()));

export const Degraded = pageStory(() =>
  renderAdminSystemPage(data({ report: report("degraded", true) })),
);

export const Starting = pageStory(() =>
  renderAdminSystemPage(data({ report: report("starting") })),
);

export const HostingOnly = pageStory(
  () => renderAdminSystemPage(data({ testing: false, hiddenSnapshots: 128 })),
  { store: { testing: false } },
);

export const RetentionPaused = pageStory(() =>
  renderAdminSystemPage(
    data({
      retentionPause: { baselineId: "01JBASELINE", buildId: "01JSOURCE", problem: "tombstoned" },
    }),
  ),
);

export const RetentionPausedOtherProject = pageStory(() =>
  renderAdminSystemPage(
    data({
      retentionPause: { baselineId: "01JBASELINE", buildId: "01JSOURCE", problem: "other-project" },
    }),
  ),
);

export const RetentionAndNotificationsPaused = pageStory(() =>
  renderAdminSystemPage(
    data({
      notificationsPaused: true,
      retentionPause: { baselineId: "01JBASELINE", buildId: "01JSOURCE", problem: "tombstoned" },
    }),
  ),
);

export const UnverifiedDefaultBranch = pageStory(() =>
  renderAdminSystemPage(
    data({
      unverifiedDefault: [
        { name: "Design system", slug: "design-system" },
        { name: "Web app", slug: "web-app" },
      ],
    }),
  ),
);

const integrationStatuses: IntegrationsView["statuses"] = [
  { group: "notifiers", kind: "github", name: "GitHub", state: "available" },
  { group: "notifiers", kind: "gitlab", name: "GitLab", state: "available" },
  {
    group: "notifiers",
    kind: "email",
    name: "Email",
    state: "unavailable",
    reason: "Email has no transport: set SMTP_HOST and SMTP_FROM or configure a sender",
  },
  { group: "notifiers", kind: "slack-webhook", name: "Slack", state: "available" },
  {
    group: "notifiers",
    kind: "teams-workflow",
    name: "Microsoft Teams",
    state: "disabled",
    reason: "Turned off by the operator",
  },
  { group: "design", kind: "figma", name: "Figma", state: "available" },
];

/** Every integration offered: the card lists them all, and no channel is held back. */
export const IntegrationsAllAvailable = pageStory(() =>
  renderAdminSystemPage(
    data({
      integrations: {
        statuses: integrationStatuses.map((status) => ({
          group: status.group,
          kind: status.kind,
          name: status.name,
          state: "available",
        })),
        channels: [],
      },
    }),
  ),
);

/** Email has no sender and Teams is turned off: their channels are kept, listed here, not delivered to. */
export const IntegrationsTurnedOffChannels = pageStory(() =>
  renderAdminSystemPage(
    data({
      integrations: {
        statuses: integrationStatuses,
        channels: [
          {
            id: "01JD000000000000000000CHN010",
            provider: "email",
            project: { name: "Design System", href: "/projects/design-system/settings/review" },
            reason: "Email has no transport: set SMTP_HOST and SMTP_FROM or configure a sender",
          },
          {
            id: "01JD000000000000000000CHN011",
            provider: "teams-workflow",
            project: null,
            reason: "Turned off by the operator",
          },
        ],
      },
    }),
  ),
);
