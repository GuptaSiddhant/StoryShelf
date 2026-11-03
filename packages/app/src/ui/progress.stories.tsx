// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Progress, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Progress" };
export default meta;

export const States = jsxStory(() => (
  <VStack>
    <Progress value={0} max={40} label="Captured 0 of 40" />
    <Progress value={18} max={40} label="Captured 18 of 40" />
    <Progress value={40} max={40} label="Captured 40 of 40" />
  </VStack>
));
