// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import { Avatar, AvatarGroup, HStack, VStack } from "./components.tsx";

/** A 1px picture, so the story needs no network request. */
const PICTURE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23888'/%3E%3C/svg%3E";

const meta: Meta = { title: "UI/Avatar" };
export default meta;

export const Initials = jsxStory(() => (
  <VStack>
    {(["sm", "md", "lg"] as const).map((size) => (
      <HStack key={size}>
        <Avatar name="Ada Lovelace" size={size} />
        <Avatar name="grace.hopper@example.com" size={size} />
        <Avatar name="Linus" size={size} />
      </HStack>
    ))}
  </VStack>
));

/** No name: a "?" hidden from assistive tech (no `role="img"` with an empty label), with or without an image. */
export const NoName = jsxStory(() => (
  <VStack>
    {(["sm", "md", "lg", "xl"] as const).map((size) => (
      <HStack key={size}>
        <Avatar name="" size={size} />
        <Avatar name="  " size={size} />
        <Avatar name="" src={PICTURE} size={size} />
      </HStack>
    ))}
  </VStack>
));

export const Extra = jsxStory(() => <Avatar name="Ada Lovelace" size="xl" />);

export const Group = jsxStory(() => (
  <AvatarGroup>
    <Avatar name="Ada Lovelace" />
    <Avatar name="Grace Hopper" />
    <Avatar name="Alan Turing" />
  </AvatarGroup>
));
