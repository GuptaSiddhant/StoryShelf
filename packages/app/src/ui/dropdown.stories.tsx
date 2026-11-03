// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import {
  Avatar,
  Card,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  HStack,
  Meta as MetaText,
  VStack,
} from "./components.tsx";

const meta: Meta = { title: "UI/Dropdown" };
export default meta;

const items = (
  <>
    <DropdownItem href="#profile" icon="user">
      Profile
    </DropdownItem>
    <DropdownItem href="#settings" icon="settings" current>
      Settings
    </DropdownItem>
    <DropdownDivider />
    <DropdownItem href="#sign-out" icon="log-out">
      Sign out
    </DropdownItem>
  </>
);

export const Closed = jsxStory(() => (
  <HStack>
    <Dropdown label="Account">{items}</Dropdown>
    <Dropdown
      label={<Avatar name="Ada Lovelace" size="sm" />}
      ariaLabel="Account menu"
      iconOnly
      align="end"
    >
      {items}
    </Dropdown>
  </HStack>
));

/** The menu open, with room below it so the items are visible in a capture. */
export const Open = jsxStory(
  () => (
    <VStack gap="lg">
      <HStack>
        <Dropdown label="Account">{items}</Dropdown>
      </HStack>
      <Card>
        <MetaText>Space the open menu overlaps.</MetaText>
        <br />
        <br />
        <br />
        <br />
      </Card>
    </VStack>
  ),
  { open: true },
);
