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
