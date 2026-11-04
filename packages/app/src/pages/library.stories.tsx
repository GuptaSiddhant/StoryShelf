// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { renderLibraryPage } from "./library.tsx";

const meta: Meta = { title: "Pages/Library/Library" };
export default meta;

export const Populated = pageStory(() => renderLibraryPage("design-system"));

export const NoBuildsYet = pageStory(() => renderLibraryPage("design-system"), {
  dataset: "empty",
});

export const TestingOff = pageStory(() => renderLibraryPage("design-system"), {
  store: { testing: false },
});
