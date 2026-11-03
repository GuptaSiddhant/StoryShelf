// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { FilterInput, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/FilterInput" };
export default meta;

export const Default = jsxStory(() => (
  <VStack>
    <FilterInput label="Filter stories" />
    <FilterInput label="Filter stories" placeholder="Search components…" />
  </VStack>
));
