// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { baselineShot } from "../../.storybook/assets/screens.ts";
import { jsxStory } from "../../.storybook/render.tsx";
import { HStack, Thumbnail } from "./components.tsx";

const meta: Meta = { title: "UI/Thumbnail" };
export default meta;

export const States = jsxStory(() => (
  <HStack align="start" gap="lg">
    <Thumbnail src={baselineShot} alt="Kit/Button default" />
    <Thumbnail src={null} alt="Kit/Card default" />
    <Thumbnail alt="Kit/Modal default" placeholder="Not captured" />
  </HStack>
));
