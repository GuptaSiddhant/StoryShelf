// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import type { Build, Snapshot } from "@storyshelf/core/schema";
import { pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import {
  BUILD_CANCELLED,
  BUILD_CAPTURING,
  BUILD_FAILED,
  BUILD_MAIN,
  BUILD_REJECTED,
  BUILD_REVIEW,
  builds,
  project,
  snapshots,
} from "../stories-fixtures/dataset.ts";
import { NEW_STORY_ID, reviewData } from "../stories-fixtures/review.ts";
import { loadBuildDetails } from "./build-detail.tsx";
import { type BuildDiffData, renderBuildDiffPage } from "./build-diff.tsx";

const meta: Meta = { title: "Pages/Builds/Build page" };
export default meta;

const fixture = (id: string): Build => {
  const found = builds.find((item) => item.id === id);
  if (!found) throw new Error(`fixture missing: ${id}`);
  return found;
};
const capturing = (): Build => fixture(BUILD_CAPTURING);
const review = (): Build => fixture(BUILD_REVIEW);

/** The build page for one fixture build, with its details panel loaded from the story database. */
async function buildPage(
  buildId: string,
  patch: Partial<BuildDiffData> = {},
): Promise<RenderedContent> {
  const build = builds.find((item) => item.id === buildId);
  if (!build) throw new Error(`fixture missing: ${buildId}`);
  const owner = patch.project ?? project;
  return renderBuildDiffPage({
    ...reviewData(),
    build,
    snapshots: snapshots.filter((snapshot) => snapshot.buildId === buildId),
    comments: [],
    selectedId: undefined,
    details: await loadBuildDetails(owner, build),
    ...patch,
  });
}

/** Undecided changes: the stage, the Approve all / Reject all header and the collapsed details. */
export const Reviewing = pageStory(() => buildPage(BUILD_REVIEW));

/** Every change decided: nothing left to approve in the header. */
export const Approved = pageStory(() => buildPage(BUILD_MAIN));

/** Capture failed: the reason and Retry capture sit in the strip and the stage, no menu to open. */
export const Failed = pageStory(() => buildPage(BUILD_FAILED));

/** A cancelled build is terminal: nothing to review, and Retry is one click away. */
export const Cancelled = pageStory(() => buildPage(BUILD_CANCELLED));

/** Capturing: "Capturing… n of m" in the strip, and a stage that says snapshots are on their way. */
export const Capturing = pageStory(() => buildPage(BUILD_CAPTURING));

/** Queued: waiting for a capture worker. */
export const Queued = pageStory(() =>
  buildPage(BUILD_CAPTURING, { build: { ...capturing(), status: "pending" } }),
);

/** Rejected: a terminal verdict, nothing left to approve. */
export const Rejected = pageStory(() => buildPage(BUILD_REJECTED));

/** A finished build whose Storybook has no stories: a real "No stories" state. */
export const NoStories = pageStory(() =>
  buildPage(BUILD_REVIEW, { snapshots: [], build: { ...review(), status: "approved" } }),
);

/** The baseline moved after the diffs were computed: a one-line warning with Re-diff. */
export const StaleBaseline = pageStory(() =>
  buildPage(BUILD_REVIEW, {
    drifted: Object.fromEntries(
      reviewData().snapshots.map((snapshot) => [snapshot.id, "stale" as const]),
    ),
  }),
);

/** Capture off: review only. No stage; the verdict and the discussion stay in view. */
export const TestingOff = pageStory(() => buildPage(BUILD_MAIN), { store: { testing: false } });

/** Review off: capture and the stage stay, without Approve all or any verdict controls. */
export const ReviewOff = pageStory(() =>
  buildPage(BUILD_REVIEW, { project: { ...project, reviewEnabled: false } }),
);

/** A changed snapshot against its baseline: side by side, with the diff and the thread. */
export const ChangedAgainstBaseline = pageStory(() => renderBuildDiffPage(reviewData()));

/** A reference build for the baseline line ("vs main · abc1234 · updated …"). */
const referenceBuild = builds.find((item) => item.id === BUILD_MAIN) ?? null;

/** The baseline line under the heading: what this snapshot was compared with, in one quiet line. */
export const ComparedWithMain = pageStory(() =>
  renderBuildDiffPage(
    reviewData({
      reference: {
        kind: "known",
        branch: "main",
        defaultBranch: true,
        updatedAt: referenceBuild?.updatedAt ?? "2026-01-14T12:00:00.000Z",
        imageAvailable: true,
        imageSize: { width: 640, height: 400 },
        build: referenceBuild,
      },
      currentSize: { width: 640, height: 400 },
    }),
  ),
);

/**
 * The current screenshot is a different size from its baseline: "560×350 → 640×400" and a "sizes
 * differ" badge instead of a 100% diff, and both images drawn at one scale.
 */
export const SizesDiffer = pageStory(() =>
  renderBuildDiffPage(
    reviewData({
      reference: {
        kind: "known",
        branch: "main",
        defaultBranch: true,
        updatedAt: referenceBuild?.updatedAt ?? "2026-01-14T12:00:00.000Z",
        imageAvailable: true,
        imageSize: { width: 560, height: 350 },
        build: referenceBuild,
      },
      currentSize: { width: 640, height: 400 },
    }),
  ),
);

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

/** The review data with the selected snapshot patched (a new object, the fixture is shared). */
function withSelected(patch: Partial<Snapshot>): ReturnType<typeof reviewData> {
  const data = reviewData();
  return {
    ...data,
    snapshots: data.snapshots.map((snapshot) =>
      snapshot.id === data.selectedId ? Object.assign({}, snapshot, patch) : snapshot,
    ),
  };
}

/** An inherited snapshot: its accessibility findings come from the baseline build and say so. */
export const FindingsFromBaseline = pageStory(() =>
  renderBuildDiffPage(
    withSelected({
      inherited: true,
      a11yViolations: JSON.stringify([
        "from baseline 3f9c2ab",
        "color-contrast (serious): Elements must meet minimum color contrast ratio thresholds [button.primary] 1 node",
      ]),
    }),
  ),
);

/** The story's a11y parameters could not be read (a cycle), so axe ran with its defaults. */
export const ParametersNotApplied = pageStory(() =>
  renderBuildDiffPage(
    withSelected({
      a11yViolations: JSON.stringify([
        "a11y parameters not serializable: refers to itself (cyclic)",
      ]),
    }),
  ),
);
