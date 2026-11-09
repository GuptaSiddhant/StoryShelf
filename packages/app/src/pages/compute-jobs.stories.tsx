// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import {
  BUILD_CAPTURING,
  BUILD_FAILED,
  BUILD_REVIEW,
  project,
} from "../stories-fixtures/dataset.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import { renderComputeJobsPage } from "./compute-jobs.tsx";

const meta: Meta = { title: "Pages/Builds/Compute jobs" };
export default meta;

const queue = [
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

/** Queued, running and a failed job above the history; a viewer who may retry sees Retry on failed builds. */
export const Busy = pageStory(() => renderComputeJobsPage(project.slug, queue, true));

/** Nothing queued: the empty line in the queue card, the history below. */
export const QueueEmpty = pageStory(() => renderComputeJobsPage(project.slug, [], true));

/** A viewer who may not retry: the same page without the Retry buttons. */
export const CannotRetry = pageStory(() => renderComputeJobsPage(project.slug, queue, false));

/** A project with no builds yet: the history says so. */
export const NoBuildsYet = pageStory(() => renderComputeJobsPage(project.slug, [], true), {
  dataset: "empty",
});

/** The queue and the history on a 375px phone: each table scrolls in its own region. */
export const OnAPhone = onAPhone(pageStory(() => renderComputeJobsPage(project.slug, queue, true)));
