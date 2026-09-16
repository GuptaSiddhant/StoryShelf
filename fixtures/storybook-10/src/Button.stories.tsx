import preview from "../.storybook/preview";

import { Button } from "./Button";

const meta = preview.meta({
  title: "Components/Button",
  component: Button,
  args: { label: "Button" },
});

export const Primary = meta.story({
  args: { variant: "primary" },
});

export const Secondary = meta.story({
  args: { variant: "secondary" },
});

// Disabled snapshot — skipped entirely (no capture, no play)
export const Disabled = meta.story({
  args: { variant: "primary", label: "Disabled" },
  tags: ["skip"],
  parameters: { storyshelf: { disableSnapshot: true } },
});

// Flaky via tags (case-insensitive, whole story non-blocking)
export const FlakyTag = meta.story({
  args: { variant: "primary", label: "Flaky Tag" },
  tags: ["flaky-test"],
  play: async () => {
    throw new Error("flaky tag failure");
  },
});

// Flaky via parameters (storyshelf wins over chromatic) — also tagged for file-based detection
export const FlakyParam = meta.story({
  args: { variant: "secondary", label: "Flaky Param" },
  tags: ["flaky-test"],
  parameters: { storyshelf: { flakyTest: true } },
  play: async () => {
    throw new Error("flaky param failure");
  },
});

// Chromatic key still works (alias) — also tagged
export const ChromaticFlaky = meta.story({
  args: { variant: "primary", label: "Chromatic Flaky" },
  tags: ["flaky-test"],
  parameters: { chromatic: { flakyTest: true } } as unknown as Record<string, unknown>,
  play: async () => {
    throw new Error("chromatic flaky");
  },
});

// Blocking failure — whole build becomes failed when play is enabled
export const BlockingFailure = meta.story({
  args: { variant: "secondary", label: "Blocking" },
  play: async () => {
    throw new Error("blocking play failure");
  },
});

// Delayed story — per-story delay
export const WithDelay = meta.story({
  args: { variant: "primary", label: "Delayed" },
  parameters: { storyshelf: { delay: 100 } },
});

// CSF-Next test — should be filtered by StoryShelf (subtype:'test')
import { expect } from "storybook/test";

export const DisabledTest = Disabled.test("should be disabled", async ({ canvas, userEvent }: any) => {
  const button = await canvas.findByRole("button");
  await userEvent.click(button);
  await expect(button).toBeInTheDocument();
});
