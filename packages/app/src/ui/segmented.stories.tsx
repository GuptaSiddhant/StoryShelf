// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Segmented, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Segmented" };
export default meta;

export const Toggle = jsxStory(() => (
  <Segmented
    label="Compare view"
    items={[
      { label: "Split", value: "split", active: true },
      { label: "Swipe", value: "swipe" },
      { label: "Onion", value: "onion" },
    ]}
  />
));

export const AsLinks = jsxStory(() => (
  <VStack>
    <Segmented
      label="Status filter"
      items={[
        { label: "All", value: "all", href: "#all", active: true },
        { label: "Changed", value: "changed", href: "#changed" },
        { label: "New", value: "new", href: "#new" },
      ]}
    />
  </VStack>
));
