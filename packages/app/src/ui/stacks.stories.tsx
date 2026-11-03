// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Badge, HStack, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Stacks" };
export default meta;

const items = ["One", "Two", "Three"].map((label) => <Badge key={label}>{label}</Badge>);

export const HorizontalGaps = jsxStory(() => (
  <VStack>
    {(["sm", "md", "lg"] as const).map((gap) => (
      <HStack key={gap} gap={gap}>
        <Badge tone="info">gap {gap}</Badge>
        {items}
      </HStack>
    ))}
  </VStack>
));

export const HorizontalJustify = jsxStory(() => (
  <VStack>
    {(["start", "center", "end", "between"] as const).map((justify) => (
      <HStack key={justify} justify={justify}>
        <Badge tone="info">{justify}</Badge>
        {items}
      </HStack>
    ))}
  </VStack>
));

export const VerticalGaps = jsxStory(() => (
  <HStack align="start" gap="lg">
    {(["sm", "md", "lg"] as const).map((gap) => (
      <VStack key={gap} gap={gap}>
        <Badge tone="info">gap {gap}</Badge>
        {items}
      </VStack>
    ))}
  </HStack>
));
