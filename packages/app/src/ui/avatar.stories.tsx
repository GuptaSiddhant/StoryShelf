// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Avatar, AvatarGroup, HStack, VStack } from "./components.tsx";

const meta: Meta = { title: "UI/Avatar" };
export default meta;

export const Initials = jsxStory(() => (
  <VStack>
    {(["sm", "md", "lg"] as const).map((size) => (
      <HStack key={size}>
        <Avatar name="Ada Lovelace" size={size} />
        <Avatar name="grace.hopper@example.com" size={size} />
        <Avatar name="Linus" size={size} />
        <Avatar name="" size={size} />
      </HStack>
    ))}
  </VStack>
));

export const Group = jsxStory(() => (
  <AvatarGroup>
    <Avatar name="Ada Lovelace" />
    <Avatar name="Grace Hopper" />
    <Avatar name="Alan Turing" />
  </AvatarGroup>
));
