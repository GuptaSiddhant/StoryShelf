// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import {
  Alert,
  Card,
  CodeBlock,
  Meta as MetaText,
  PageHeader,
  SectionTitle,
  VStack,
} from "./components.tsx";

const meta: Meta = { title: "Docs/Introduction" };
export default meta;

export const Introduction = jsxStory(() => (
  <VStack gap="lg">
    <PageHeader
      title="StoryShelf design system"
      description="The shared components and pages of the StoryShelf app, rendered from the real source."
    />
    <Card>
      <SectionTitle>What this is</SectionTitle>
      <MetaText>
        Every story here renders the app's own hono/jsx components with the same styles and tokens
        as production: there is no second implementation. Use the toolbar to switch between light
        and dark, and the viewport menu for 375, 768 and 1280 pixel widths.
      </MetaText>
    </Card>
    <Card>
      <SectionTitle>What is in it</SectionTitle>
      <MetaText>
        <strong>UI/…</strong> is each shared component in all its variants and states.{" "}
        <strong>Pages/…</strong> is the key pages with fixed, realistic data, one story per state
        (empty, populated, error, testing or review off). Nothing is fetched and nothing is clicked
        through.
      </MetaText>
    </Card>
    <Card>
      <SectionTitle>Add a component or variant</SectionTitle>
      <VStack>
        <MetaText>
          Build it from the shared components in <code>src/ui/components.tsx</code>. Put its styles
          next to it with one labelled <code>css</code> template per variant, composed with the base
          template, using static values and the theme tokens only. Then add a story in a{" "}
          <code>*.stories.tsx</code> file beside it: a new component or variant ships with a story.
        </MetaText>
        <CodeBlock
          label="Copy"
          code={
            'export const Danger = jsxStory(() => (\n  <Badge tone="danger">Failed</Badge>\n));'
          }
        />
      </VStack>
    </Card>
    <Alert tone="info" title="Deterministic on purpose">
      The clock is frozen at 2026-01-15 12:00 UTC, ids and images are fixed, and nothing touches the
      network, so these stories can serve as visual-test baselines.
    </Alert>
  </VStack>
));
