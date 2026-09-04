import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  args: { label: "Button" },
};

export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: "primary" },
};

export const Secondary: Story = {
  args: { variant: "secondary" },
};

// Disabled snapshot — skipped entirely (no capture, no play)
// Uses both parameters and tags for file-based filtering without stories.json
export const Disabled: Story = {
  args: { variant: "primary", label: "Disabled" },
  tags: ["skip"],
  parameters: { storyshelf: { disableSnapshot: true } },
};

// Flaky via tags (case-insensitive, whole story non-blocking)
export const FlakyTag: Story = {
  args: { variant: "primary", label: "Flaky Tag" },
  tags: ["flaky-test"],
  play: async () => {
    throw new Error("flaky tag failure");
  },
};

// Flaky via parameters (storyshelf wins over chromatic) — also tagged for file-based detection
export const FlakyParam: Story = {
  args: { variant: "secondary", label: "Flaky Param" },
  tags: ["flaky-test"],
  parameters: { storyshelf: { flakyTest: true } },
  play: async () => {
    throw new Error("flaky param failure");
  },
};

// Chromatic key still works (alias) — also tagged
export const ChromaticFlaky: Story = {
  args: { variant: "primary", label: "Chromatic Flaky" },
  tags: ["flaky-test"],
  parameters: { chromatic: { flakyTest: true } } as unknown as Record<string, unknown>,
  play: async () => {
    throw new Error("chromatic flaky");
  },
};

// Blocking failure — whole build becomes failed when play is enabled
export const BlockingFailure: Story = {
  args: { variant: "secondary", label: "Blocking" },
  play: async () => {
    throw new Error("blocking play failure");
  },
};

// Delayed story — per-story delay
export const WithDelay: Story = {
  args: { variant: "primary", label: "Delayed" },
  parameters: { storyshelf: { delay: 100 } },
};

// CSF-Next test — should be filtered by StoryShelf (subtype:'test')
export const PrimaryInteractionTest = Primary.test(async ({ canvas, userEvent }: any) => {
  await userEvent.click(canvas.getByRole("button"));
});
