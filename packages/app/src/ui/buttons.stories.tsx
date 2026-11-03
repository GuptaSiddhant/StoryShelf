// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Button, HStack } from "./components.tsx";

const meta: Meta = { title: "UI/Button" };
export default meta;

export const Variants = jsxStory(() => (
  <HStack>
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
  </HStack>
));
