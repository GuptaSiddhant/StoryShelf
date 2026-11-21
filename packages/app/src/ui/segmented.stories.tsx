// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone } from "../../.storybook/page.tsx";
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

/** More items than a 375px phone holds: the row scrolls and its right edge fades (#1133). */
export const OverflowingOnAPhone = onAPhone(
  jsxStory(() => (
    <Segmented
      label="Build status"
      items={[
        { label: "All 12", value: "all", href: "#all", active: true },
        { label: "Reviewing 3", value: "reviewing", href: "#reviewing" },
        { label: "Approved 4", value: "approved", href: "#approved" },
        { label: "Failed 1", value: "failed", href: "#failed" },
        { label: "Cancelled 2", value: "cancelled", href: "#cancelled" },
        { label: "Skipped 2", value: "skipped", href: "#skipped" },
      ]}
    />
  )),
);
