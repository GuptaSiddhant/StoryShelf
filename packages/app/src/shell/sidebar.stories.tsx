// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { resolveHtml } from "../../.storybook/render.tsx";
import { renderProjectBuildsPage } from "../pages/project-builds.tsx";

const meta: Meta = { title: "Shell/Sidebar" };
export default meta;

/** The builds list, which is how a project page looks inside the shell. */
const projectPage = async (): Promise<string> =>
  await resolveHtml(await renderProjectBuildsPage("design-system"));

/** Story-only: the states the client script reaches, shown as fixed markup. */
const asRail = (html: string): string => html.replace("<html ", '<html data-sidebar="rail" ');
const withFoldedGroup = (html: string, id: string): string =>
  html
    .replace(`data-nav-group="${id}"`, `data-nav-group="${id}" data-folded`)
    .replace(
      `aria-expanded="true" aria-controls="nav-group-${id}"`,
      `aria-expanded="false" aria-controls="nav-group-${id}"`,
    );
const withHelpOpen = (html: string): string =>
  html.replace(
    /<details (?<root>[^>]*data-dropdown>\s*<summary[^>]*aria-label="Help")/u,
    "<details open $<root>",
  );

/** Grouped by task: Projects, the project's Builds and Library, then Settings. */
export const Expanded = pageStory(projectPage);

/** Icon rail: every icon keeps an accessible name and a tooltip on hover and focus. */
export const IconRail = pageStory(async () => asRail(await projectPage()));

/** One group folded on its own (the choice is remembered per browser). */
export const FoldedGroup = pageStory(async () => withFoldedGroup(await projectPage(), "project"));

/** Help menu (API docs, OpenAPI spec) open beside the theme toggle. */
export const HelpMenuOpen = pageStory(async () => withHelpOpen(await projectPage()));
