// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Absent, RelativeTime, Time, VStack, valueWithUnit } from "./components.tsx";

const meta: Meta = { title: "UI/Time" };
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

const STAMP = "2026-01-15T23:30:00.000Z";

/** Always UTC and `en`, so the story renders the same on every machine. */
export const Absolute = jsxStory(() => (
  <VStack>
    <Time value={STAMP} />
    <Time value={STAMP} format="date" />
    <Time value={STAMP} format="time" />
    <Time value="not a date" />
  </VStack>
));

/** An absent value is one dash with a hidden "none"; a unit never trails a missing number. */
export const AbsentValue = jsxStory(() => (
  <VStack>
    <Absent />
    <span>Purge TTL {valueWithUnit(null, "days")}</span>
    <span>Purge TTL {valueWithUnit(30, "days")}</span>
  </VStack>
));
