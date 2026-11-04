// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { PreviewEmbed } from "./components.tsx";

const meta: Meta = { title: "UI/PreviewEmbed" };
export default meta;

/** The idle state: the preview loads on click, in a sandbox without `allow-same-origin`. */
export const Idle = jsxStory(() => (
  <PreviewEmbed src="about:blank" title="Kit / Button / Default preview" />
));
