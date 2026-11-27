// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import type { Build } from "@storyshelf/core/schema";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { resolveHtml } from "../../.storybook/render.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { BUILD_MAIN, builds, project } from "../stories-fixtures/dataset.ts";
import { renderStorybookPage, renderStorybookPreparingPage } from "./storybook.tsx";

const meta: Meta = { title: "Pages/Build/Storybook" };
export default meta;

const found = builds.find((candidate) => candidate.id === BUILD_MAIN) ?? builds[0];
if (!found) throw new Error("fixture has no build");
const build: Build = found;

/** Statics not extracted yet: a live status, a pause control and a plain "Check again" link. */
export const Preparing = pageStory(() =>
  renderStorybookPreparingPage(project, build, project.slug),
);

/**
 * The published Storybook is a separate document the server serves; a story cannot load it, so the
 * frame inside the page shows a fixed placeholder in its place.
 */
const withoutLiveFrame = async (page: RenderedContent): Promise<string> =>
  (await resolveHtml(page)).replace(
    /<iframe class="(?<classes>[^"]*)" src="[^"]*"/u,
    '<iframe class="$<classes>" srcdoc="<p style=&quot;font-family:system-ui;padding:1rem&quot;>The published Storybook loads here.</p>"',
  );

/** The published Storybook inside the project chrome, on its landing story. */
export const Published = pageStory(() =>
  withoutLiveFrame(renderStorybookPage(project, build, project.slug)),
);

/** Opened on one story, so the copied link names it. */
export const PublishedOnAStory = pageStory(() =>
  withoutLiveFrame(
    renderStorybookPage(project, build, project.slug, { storyId: "kit-button--primary" }),
  ),
);

/** Opened on a docs page. */
export const PublishedOnDocs = pageStory(() =>
  withoutLiveFrame(
    renderStorybookPage(project, build, project.slug, {
      storyId: "kit-button--docs",
      viewMode: "docs",
    }),
  ),
);

/** The header on a 375px phone: the actions wrap under the crumbs. */
export const PublishedOnAPhone = onAPhone(
  pageStory(() => withoutLiveFrame(renderStorybookPage(project, build, project.slug))),
);

/** Preparing after the automatic checks stopped: the status says so and only "Check again" is left. */
export const PreparingChecksStopped = pageStory(async () => {
  const page = await resolveHtml(renderStorybookPreparingPage(project, build, project.slug));
  return page.replace(
    /(?<open><p [^>]*id="prep-status"[^>]*>)[^<]*(?<close><\/p>)/u,
    "$<open>Still preparing. Automatic checks stopped; use Check again.$<close>",
  );
});
