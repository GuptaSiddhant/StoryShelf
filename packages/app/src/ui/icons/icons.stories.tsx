// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../../.storybook/render.tsx";
import { HStack, Icon, Meta as MetaText, VStack } from "../components.tsx";
import { ICON_PATHS, type IconName } from "./paths.ts";

const meta: Meta = { title: "UI/Icon" };
export default meta;

const names = Object.keys(ICON_PATHS).toSorted() as IconName[];

export const AllIcons = jsxStory(() => (
  <div class="grid grid--3">
    {names.map((name) => (
      <HStack key={name} gap="sm">
        <Icon name={name} />
        <MetaText as="code">{name}</MetaText>
      </HStack>
    ))}
  </div>
));

export const Sizes = jsxStory(() => (
  <VStack>
    {(["sm", "md", "lg"] as const).map((size) => (
      <HStack key={size}>
        <Icon name="check-circle" size={size} />
        <MetaText as="span">{size}</MetaText>
      </HStack>
    ))}
  </VStack>
));
