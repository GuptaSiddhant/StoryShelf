// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { HealthReport } from "../routers/health-report.ts";
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
