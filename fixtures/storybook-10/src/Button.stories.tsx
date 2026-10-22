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

// CSF-Next tests (`story.test(...)` as a bare statement: the indexer ignores an exported call).
// They are index entries with `subtype: "test"`; capture leaves them out, and a project with
// `runTests` on runs them in the iframe as interaction tests.
import { expect } from "storybook/test";

Primary.test("renders its label", async ({ canvas }) => {
  await expect(canvas.getByRole("button")).toHaveTextContent("Button");
});

Secondary.test("clicks without error", async ({ canvas, userEvent }) => {
  await userEvent.click(canvas.getByRole("button"));
  await expect(canvas.getByRole("button")).toBeInTheDocument();
});

// Fails on purpose (the "fails" test of the integration suite); inert unless a project runs tests.
Secondary.test("fails on purpose", async ({ canvas }) => {
  await expect(canvas.getByRole("button")).toHaveTextContent("Not the label");
});
