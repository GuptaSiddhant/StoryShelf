// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { renderProjectBuildsPage } from "./project-builds.tsx";

const meta: Meta = { title: "Pages/Builds/Builds list" };
export default meta;

export const Populated = pageStory(() => renderProjectBuildsPage("design-system"));

export const FilteredByStatus = pageStory(() =>
  renderProjectBuildsPage("design-system", { status: "reviewing" }),
);

export const FilterWithNoMatches = pageStory(() =>
  renderProjectBuildsPage("design-system", { status: "cancelled" }),
);

/** The stat row and build rows are wider than a phone: the page must not scroll sideways. */
export const PopulatedOnAPhone = onAPhone(
  pageStory(() => renderProjectBuildsPage("design-system")),
);

export const FilterWithNoMatchesOnAPhone = onAPhone(
  pageStory(() => renderProjectBuildsPage("design-system", { status: "cancelled" })),
);

export const NoBuildsYet = pageStory(() => renderProjectBuildsPage("design-system"), {
  dataset: "empty",
});

export const TestingOff = pageStory(() => renderProjectBuildsPage("design-system"), {
  store: { testing: false },
});

/** Skipped builds are hidden by default; the "Show skipped (N)" switch is the only sign of them. */
export const SkippedHiddenWithSwitch = pageStory(() => renderProjectBuildsPage("design-system"));

export const SkippedShown = pageStory(() =>
  renderProjectBuildsPage("design-system", { skipped: "1" }),
);

export const SkippedShownOnAPhone = onAPhone(
  pageStory(() => renderProjectBuildsPage("design-system", { skipped: "1" })),
);

export const EveryBuildSkipped = pageStory(() => renderProjectBuildsPage("design-system"), {
  dataset: "skipped-only",
});

export const EveryBuildSkippedShown = pageStory(
  () => renderProjectBuildsPage("design-system", { skipped: "1" }),
  { dataset: "skipped-only" },
);
