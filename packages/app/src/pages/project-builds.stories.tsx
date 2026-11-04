// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
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

export const NoBuildsYet = pageStory(() => renderProjectBuildsPage("design-system"), {
  dataset: "empty",
});

export const TestingOff = pageStory(() => renderProjectBuildsPage("design-system"), {
  store: { testing: false },
});
