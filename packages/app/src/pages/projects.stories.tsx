// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { renderProjectsPage } from "./projects.tsx";

const meta: Meta = { title: "Pages/Projects/Projects" };
export default meta;

export const Populated = pageStory(() => renderProjectsPage());

export const NoBuildsYet = pageStory(() => renderProjectsPage(), { dataset: "empty" });

export const NoProjects = pageStory(() => renderProjectsPage(), { dataset: "blank" });
