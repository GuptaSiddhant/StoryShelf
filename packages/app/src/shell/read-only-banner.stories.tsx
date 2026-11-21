// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { resolveHtml, jsxStory } from "../../.storybook/render.tsx";
import { renderProjectBuildsPage } from "../pages/project-builds.tsx";
import { SHARED_READ_ONLY_ACCOUNT } from "../stories-fixtures/accounts.ts";
import { ReadOnlyBanner } from "./read-only-banner.tsx";

const meta: Meta = { title: "Shell/ReadOnlyBanner" };
export default meta;

/** The banner on its own, as a read-only shared account sees it. */
export const Shown = jsxStory(() => <ReadOnlyBanner readOnly />);

/** The builds list inside the shell, signed in as the read-only shared account. */
export const OnAPage = pageStory(
  async () => await resolveHtml(await renderProjectBuildsPage("design-system")),
  { store: { authEnabled: true, user: SHARED_READ_ONLY_ACCOUNT } },
);
