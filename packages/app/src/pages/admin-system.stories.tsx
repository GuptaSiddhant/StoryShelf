// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { HealthReport } from "../routers/health-report.ts";
import { renderAdminSystemPage, type AdminSystemData } from "./admin-system.tsx";

const meta: Meta = { title: "Pages/Admin/System" };
export default meta;

const healthyStatuses: HealthReport["statuses"] = [
  { id: "telemetry", label: "Telemetry export", value: "off", tone: "off" },
  {
    id: "image-engine",
    label: "Image engine",
    value: "sharp",
    tone: "ok",
    detail: "3 diff workers",
  },
  {
    id: "public-origin",
    label: "Public origin",
    value: "confirmed",
    tone: "ok",
    detail: "https://shelf.example.com (config)",
  },
  { id: "hosting", label: "Storybook hosting", value: "trusted", tone: "ok" },
];

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
  statuses: healthyStatuses,
});

const withDependencies = (aiState: "ok" | "failed"): HealthReport => {
  const base = report("ok");
  return {
    ...base,
    status: aiState === "ok" ? "ok" : "degraded",
    adapters: [
      ...base.adapters,
      {
        category: "ai",
        kind: "ai",
        name: "AI",
        version: "-",
        hasLifecycle: true,
        state: aiState,
        latencyMs: 1,
        ...(aiState === "failed"
          ? { detail: "unsupported model specification: acme-model-1" }
          : {}),
      },
      {
        category: "auth",
        kind: "oidc",
        name: "Keycloak",
        version: "-",
        hasLifecycle: true,
        state: "ok",
        latencyMs: 84,
        detail: "discovery reachable at https://id.example.com",
      },
    ],
  };
};

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

export const DependenciesHealthy = pageStory(() =>
  renderAdminSystemPage(data({ report: withDependencies("ok") })),
);

export const DependencyFailing = pageStory(() =>
  renderAdminSystemPage(data({ report: withDependencies("failed") })),
);

export const RuntimeNeedsAttention = pageStory(() =>
  renderAdminSystemPage(
    data({
      report: {
        ...report("ok"),
        statuses: [
          {
            id: "telemetry",
            label: "Telemetry export",
            value: "on",
            tone: "ok",
            detail: "exporting to https://otel.example.com",
          },
          {
            id: "image-engine",
            label: "Image engine",
            value: "pngjs",
            tone: "ok",
            detail: "diffs run on the main thread",
          },
          {
            id: "public-origin",
            label: "Public origin",
            value: "not confirmed",
            tone: "warn",
            detail: "none configured, none reported; notifications and links are not sent",
          },
          {
            id: "hosting",
            label: "Storybook hosting",
            value: "subdomain",
            tone: "ok",
            detail: "content host *.shelf.example.com",
          },
        ],
      },
    }),
  ),
);
