// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { CodeBlock, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/CodeBlock" };
export default meta;

export const Snippets = jsxStory(() => (
  <VStack>
    <CodeBlock code="npx storyshelf upload --slug design-system --build-dir ./storybook-static" />
    <CodeBlock
      label="Copy command"
      code={
        "npx storyshelf upload \\\n  --slug design-system \\\n  --build-dir ./storybook-static \\\n  --branch main"
      }
    />
  </VStack>
));

/** A command wider than its box scrolls sideways and takes keyboard focus, so a keyboard can scroll it. */
export const LongCommand = jsxStory(() => (
  <CodeBlock code="npx storyshelf upload --url https://storyshelf.example.com --slug design-system --build-dir ./storybook-static --branch main --token $STORYSHELF_UPLOAD_TOKEN --message 'Update the design tokens and the button focus ring'" />
));
