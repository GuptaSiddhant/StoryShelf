// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { BUILD_MAIN, builds, project } from "../stories-fixtures/dataset.ts";
import { renderStorybookPreparingPage } from "./storybook.tsx";

const meta: Meta = { title: "Pages/Build/Storybook" };
export default meta;

/** Statics not extracted yet: a live status, a pause control and a plain "Check again" link. */
export const Preparing = pageStory(() => {
  const build = builds.find((candidate) => candidate.id === BUILD_MAIN) ?? builds[0];
  if (!build) throw new Error("fixture has no build");
  return renderStorybookPreparingPage(project, build, project.slug);
});
