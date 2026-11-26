// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone } from "../../.storybook/page.tsx";
import { jsxStory } from "../../.storybook/render.tsx";
import { Button, HStack, Tabs, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Button" };
export default meta;

const variants = [
  "primary",
  "secondary",
  "ghost",
  "danger",
  "danger-secondary",
  "outline",
] as const;

export const Variants = jsxStory(() => (
  <VStack>
    {(["md", "sm"] as const).map((size) => (
      <HStack key={size}>
        {variants.map((variant) => (
          <Button key={variant} variant={variant} size={size}>
            {variant} {size}
          </Button>
        ))}
      </HStack>
    ))}
  </VStack>
));

export const Disabled = jsxStory(() => (
  <HStack>
    {variants.map((variant) => (
      <Button key={variant} variant={variant} disabled>
        {variant}
      </Button>
    ))}
  </HStack>
));

export const WithIcon = jsxStory(() => (
  <HStack>
    <Button icon="check">Approve</Button>
    <Button variant="secondary" icon="external-link">
      View Storybook
    </Button>
    <Button variant="ghost" size="sm" icon="copy">
      Copy
    </Button>
    <Button variant="danger" icon="x">
      Reject
    </Button>
    <Button variant="danger-secondary" size="sm" icon="x">
      Reject
    </Button>
  </HStack>
));

export const AsLink = jsxStory(() => (
  <HStack>
    <Button href="#builds">Open builds</Button>
    <Button variant="secondary" href="#builds" disabled>
      Disabled link
    </Button>
  </HStack>
));

const tabs = (active: string): { label: string; href: string; active: boolean }[] =>
  ["Stories", "States", "History", "Design"].map((label) => ({
    label,
    href: `#${label.toLowerCase()}`,
    active: label === active,
  }));

export const TabBar = jsxStory(() => <Tabs label="Component sections" tabs={tabs("States")} />);

/** Four settings tabs in 375px: the row scrolls, fades at its edge and opens on the current tab (#1133). */
export const TabBarOverflowingOnAPhone = onAPhone(
  jsxStory(() => (
    <Tabs
      label="Settings sections"
      tabs={["General", "Capture & tests", "Review & notifications", "Access"].map(
        (label, index) => ({
          label,
          href: `#${index}`,
          active: label === "Review & notifications",
        }),
      )}
    />
  )),
);

/** A `<button>` and an `<a>` of one variant draw in the same typeface (the reset sets it on controls). */
export const ButtonAndLinkSideBySide = jsxStory(() => (
  <HStack>
    <Button variant="secondary" size="sm" href="/example">
      Install on GitHub
    </Button>
    <Button variant="secondary" size="sm" type="button">
      Remove
    </Button>
  </HStack>
));
