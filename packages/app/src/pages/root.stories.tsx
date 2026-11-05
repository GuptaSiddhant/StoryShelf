// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { renderRootPage } from "./root.tsx";

const meta: Meta = { title: "Pages/Root/Welcome" };
export default meta;

/** The landing page: the pitch, the two entry buttons, the CLI tip and the capture / diff / review steps. It has no other state. */
export const Welcome = pageStory(() => renderRootPage());

/** The same page on a 375px phone: the three steps stack and nothing scrolls sideways. */
export const OnAPhone = onAPhone(pageStory(() => renderRootPage()));
