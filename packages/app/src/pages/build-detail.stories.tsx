// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import {
  BUILD_CAPTURING,
  BUILD_FAILED,
  BUILD_MAIN,
  BUILD_REJECTED,
  BUILD_REVIEW,
  BUILD_SKIPPED,
  BUILD_SKIPPED_MANY_FILES,
  BUILD_SKIPPED_PURGED_STORYBOOK,
  BUILD_SKIPPED_REJECTED_SOURCE,
  BUILD_SKIPPED_SOURCE_GONE,
} from "../stories-fixtures/dataset.ts";
import { renderBuildDetailPage } from "./build-detail.tsx";

const meta: Meta = { title: "Pages/Builds/Build detail" };
export default meta;

export const InReview = pageStory(() => renderBuildDetailPage(BUILD_REVIEW));

export const Approved = pageStory(() => renderBuildDetailPage(BUILD_MAIN));

export const Capturing = pageStory(() => renderBuildDetailPage(BUILD_CAPTURING));

export const Failed = pageStory(() => renderBuildDetailPage(BUILD_FAILED));

export const Rejected = pageStory(() => renderBuildDetailPage(BUILD_REJECTED));

export const TestingOff = pageStory(() => renderBuildDetailPage(BUILD_MAIN), {
  store: { testing: false },
});

/** A skipped build (ADR 0044) repeats a source build: one story per state of that source. */
export const SkippedSourceApproved = pageStory(() => renderBuildDetailPage(BUILD_SKIPPED));

export const SkippedSourceRejectedLater = pageStory(() =>
  renderBuildDetailPage(BUILD_SKIPPED_REJECTED_SOURCE),
);

export const SkippedSourceStorybookGone = pageStory(() =>
  renderBuildDetailPage(BUILD_SKIPPED_PURGED_STORYBOOK),
);

export const SkippedSourceGone = pageStory(() => renderBuildDetailPage(BUILD_SKIPPED_SOURCE_GONE));

export const SkippedManyChangedFiles = pageStory(() =>
  renderBuildDetailPage(BUILD_SKIPPED_MANY_FILES),
);

export const SkippedOnAPhone = onAPhone(pageStory(() => renderBuildDetailPage(BUILD_SKIPPED)));
