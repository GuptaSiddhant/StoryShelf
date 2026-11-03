// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { RelativeTime, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/RelativeTime" };
export default meta;

/** The clock is frozen at 2026-01-15 12:00 UTC (see `.storybook/render.tsx`). */
const ago = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString();

export const Ranges = jsxStory(() => (
  <VStack>
    {[10, 300, 7200, 172_800, 1_000_000].map((seconds) => (
      <RelativeTime key={seconds} value={ago(seconds)} />
    ))}
    <RelativeTime value="not a date" />
  </VStack>
));
