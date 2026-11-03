// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { NEW_STORY_ID, reviewData } from "../stories-fixtures/review.ts";
import { renderBuildDiffPage } from "./build-diff.tsx";

const meta: Meta = { title: "Pages/Builds/Review stage" };
export default meta;

/** A changed snapshot against its baseline: side by side, with the diff and the thread. */
export const ChangedAgainstBaseline = pageStory(() => renderBuildDiffPage(reviewData()));

/** A story with no baseline yet: nothing to compare, the current render is the proposal. */
export const NewStory = pageStory(() =>
  renderBuildDiffPage(reviewData({ selectedId: NEW_STORY_ID })),
);

/** A viewer who cannot decide: the same stage without the approve and reject controls. */
export const ReadOnly = pageStory(() => renderBuildDiffPage(reviewData({ canReview: false })));

export const BaselineMoved = pageStory(() =>
  renderBuildDiffPage(
    reviewData({
      drifted: Object.fromEntries(
        reviewData().snapshots.map((snapshot) => [snapshot.id, "stale" as const]),
      ),
    }),
  ),
);

const figma = {
  url: "https://www.figma.com/design/KEY/Kit?node-id=1-2",
  providerName: "Figma",
  name: "Button / Primary",
  state: "ok",
  renderUrl: "/api/v1/projects/design-system/design/render?node=1-2",
  stale: false,
};

/** The linked Figma frame beside the screenshot: compare against the design, not a baseline. */
export const AgainstDesign = pageStory(() => renderBuildDiffPage(reviewData({ design: [figma] })));

/** The design changed after the baseline was approved: the page says the reference is newer. */
export const DesignChangedAfterApproval = pageStory(() =>
  renderBuildDiffPage(reviewData({ design: [{ ...figma, stale: true }] })),
);

/** The linked design node no longer exists. */
export const DesignDeleted = pageStory(() =>
  renderBuildDiffPage(
    reviewData({ design: [{ ...figma, state: "deleted", renderUrl: null, name: null }] }),
  ),
);
