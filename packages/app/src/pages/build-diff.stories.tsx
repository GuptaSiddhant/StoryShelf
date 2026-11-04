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

/* The review stage in each comparison mode and zoom, as fixed states that can be captured. */

/** Swipe between the baseline and the current screenshot. */
export const ChangedSwipe = pageStory(() => renderBuildDiffPage(reviewData()), {
  stage: { view: "swipe" },
});

/** Onion skin: the current screenshot over the baseline. */
export const ChangedOnionSkin = pageStory(() => renderBuildDiffPage(reviewData()), {
  stage: { view: "onion" },
});

/** Diff only: the changed pixels. */
export const ChangedDiffOnly = pageStory(() => renderBuildDiffPage(reviewData()), {
  stage: { view: "diff" },
});

/** Flip between the current screenshot and the baseline. */
export const ChangedFlip = pageStory(() => renderBuildDiffPage(reviewData()), {
  stage: { view: "flip" },
});

/** Zoomed to 200%: the images scroll inside their panes. */
export const ChangedZoom200 = pageStory(() => renderBuildDiffPage(reviewData()), {
  stage: { zoom: "200" },
});

/**
 * The comparison controls work here: the shell's own client script runs in the page frame for
 * this story only. Try the modes, the zoom levels, the sliders and the flip.
 */
export const Interactive = pageStory(() => renderBuildDiffPage(reviewData()), {
  interactive: true,
});
