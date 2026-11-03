// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Button, HStack, Tabs, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Button" };
export default meta;

const variants = ["primary", "secondary", "ghost", "danger", "outline"] as const;

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
