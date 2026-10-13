import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Components/Themed",
  component: Button,
  args: { label: "Themed", variant: "secondary" },
};

export default meta;

type Story = StoryObj<typeof Button>;

// Modes via the `storyshelf` key: captured on desktop plus a light and a dark mode.
export const Surface: Story = {
  parameters: {
    storyshelf: { modes: { light: { theme: "light" }, dark: { theme: "dark" } } },
  },
};

// Modes via the `chromatic` key (alias): dark theme at a phone width.
export const ChromaticAlias: Story = {
  parameters: {
    chromatic: { modes: { "dark mobile": { theme: "dark", viewport: "mobile1" } } },
  } as unknown as Record<string, unknown>,
};
