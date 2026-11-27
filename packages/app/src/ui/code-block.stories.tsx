// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone } from "../../.storybook/page.tsx";
import { jsxStory } from "../../.storybook/render.tsx";
import { CodeBlock, Command, Meta as MetaText, VStack } from "./components.tsx";

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
  <CodeBlock code="SHELF_TOKEN=$TOKEN npx storyshelf upload --url https://storyshelf.example.com --slug design-system --build-dir ./storybook-static --branch main --message 'Update the design tokens and the button focus ring'" />
));

/** An inline command in running text breaks only between words: `--name` never splits into `-` and `-name`. */
export const InlineCommand = jsxStory(() => (
  <MetaText>
    Tip: use{" "}
    <Command>
      npx storyshelf create --url &lt;url&gt; --name &lt;name&gt; --token $SHELF_ADMIN_TOKEN
    </Command>{" "}
    to create a project, or <Command>npx storyshelf init</Command> to write{" "}
    <Command>.storybook/storyshelf.json</Command>.
  </MetaText>
));

/** The same tip on a 375px phone: the lines end between words, never inside a flag. */
export const InlineCommandOnAPhone = onAPhone(InlineCommand);
