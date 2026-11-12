// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import {
  BUILD_CAPTURING,
  BUILD_FAILED,
  BUILD_REVIEW,
  builds,
  project,
} from "../stories-fixtures/dataset.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import type { QueueView } from "./compute-jobs.tsx";
import { renderProjectSettingsPage } from "./project-settings.tsx";
import type { SettingsInsightsData } from "./settings-insights.tsx";

const meta: Meta = { title: "Pages/Settings/Insights" };
export default meta;

const queue: QueueView[] = [
  {
    buildId: BUILD_CAPTURING,
    status: "capturing",
    queuedAt: hoursAgo(0.12),
    startedAt: hoursAgo(0.1),
  },
  { buildId: BUILD_REVIEW, status: "pending", queuedAt: hoursAgo(0.05) },
  {
    buildId: BUILD_FAILED,
    status: "failed",
    queuedAt: hoursAgo(20),
    startedAt: hoursAgo(19.9),
    finishedAt: hoursAgo(19.8),
    error: "Capture timed out after 300 s while rendering kit-modal--open",
  },
];

const newest = builds.find((item) => item.id === BUILD_REVIEW) ?? builds[0];

const populated: SettingsInsightsData = {
  builds,
  testing: true,
  health: null,
  latest: newest
    ? {
        build: newest,
        timings: { measured: 8, averageMs: 1840, p95Ms: 4200, slowestMs: 6100 },
        a11y: { findings: 7, snapshots: 3, fromBaseline: 2, baselineSnapshots: 1, unavailable: 0 },
      }
    : null,
  queue,
  canRetry: true,
};

const empty: SettingsInsightsData = {
  builds: [],
  testing: true,
  health: null,
  latest: null,
  queue: [],
  canRetry: true,
};

/** The Insights tab of the project settings with the given data. */
const insightsPage = (insights: SettingsInsightsData): RenderedContent =>
  renderProjectSettingsPage({
    project,
    activeTab: "insights",
    insights,
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
  });

/** Capture reuse, timings and accessibility totals of the newest captured build, then the jobs: queued, running and a failed job. */
export const Populated = pageStory(() => insightsPage(populated));

/** A project with no builds yet: no numbers to show, an empty queue and an empty history. */
export const Empty = pageStory(() => insightsPage(empty), { dataset: "empty" });

/** A viewer who may not retry: the same tab without the Retry buttons. */
export const CannotRetry = pageStory(() => insightsPage({ ...populated, canRetry: false }));

/** The tab on a 375px phone: the stat rows wrap and each table scrolls in its own region. */
export const OnAPhone = onAPhone(pageStory(() => insightsPage(populated)));
