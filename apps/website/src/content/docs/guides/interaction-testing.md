---
title: Interaction testing
description: Run Storybook play functions before screenshots — opt-in per project, with flaky and disable controls.
---

StoryShelf can run your Storybook `play` functions before each screenshot. When enabled, a failing `play` blocks the build (`failed`) so you can drop a separate `storybook test` / `vitest` CI job. Flaky stories can be marked non-blocking.

## Enable it (opt-in)

Interaction tests are **off by default** (existing 500 ms `networkidle` behaviour is preserved).

1. Open your project → **Settings → Tests**
2. Check **Enable interaction tests (play)**
3. Set **Play timeout (ms)** (1000–30000, default 10000)
4. Save

Only that project's builds will execute `play`. Global `viewports` (`ShelfConfig.viewports`) stay the default; per-story viewports remain deferred.

## Writing `play` functions

`play` is standard Storybook CSF:

```ts
// src/Button.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { Button } from "./Button";

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: "primary" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button"));
    await expect(canvas.getByText("Clicked")).toBeVisible();
  },
};
```

The runner does `page.goto(iframe.html?id=...&viewMode=story)` → `waitForSelector(#storybook-root, attached)` → `waitForTimeout(delay ?? 500)` → *if enabled* `page.evaluate(executePlay)` with `playTimeoutMs` → `screenshot({animations: disabled})`. No code change in `.storybook/main.ts` is required.

## Per-story controls

StoryShelf reads `parameters` from the Storybook build. Both **chromatic** and **storyshelf** keys are supported; **`storyshelf` wins** on conflict so existing Chromatic users work unchanged.

| Parameter | Where | Effect |
|---|---|---|
| `disableSnapshot` | `parameters: { storyshelf: { disableSnapshot: true } }` or `chromatic:{disableSnapshot:true}` | Skip capture + play entirely — not counted, no `failed` |
| `flakyTest` | `parameters: { storyshelf: { flakyTest: true } }` or `chromatic:{flakyTest:true}` | Failure is **non-blocking**: build stays `reviewing`/`approved`, UI shows warning, GitHub status stays `success` with a warning comment |
| `delay` | `parameters: { storyshelf: { delay: 300 } }` | Extra wait (ms) after `play` before screenshot (default 500 when no delay) |
| `diffThreshold` | `parameters: { storyshelf: { diffThreshold: 0.2 } }` | Per-story `pixelThreshold` override (0–1) |
| `pauseAnimationAtEnd` | `parameters: { storyshelf: { pauseAnimationAtEnd: true } }` | Pause CSS animations before screenshot; otherwise `animations:"disabled"` |

Tags are story-level and case-insensitive. Whole-story non-blocking:

```ts
// via tags (works even when index.json has no parameters)
export const Flaky: Story = {
  tags: ["flaky-test"],
  play: async () => { throw new Error("flake"); },
};

// via parameters (both keys work)
export const FlakyParam: Story = {
  parameters: { storyshelf: { flakyTest: true } },
  play: async () => { throw new Error("flake"); },
};
export const ChromaticFlaky: Story = {
  parameters: { chromatic: { flakyTest: true } },
  play: async ({ canvasElement }) => { /* ... */ },
};

export const Hidden: Story = {
  parameters: { storyshelf: { disableSnapshot: true } },
  // or tags: ["skip"] — also disables via isDisabledStory
};
```

`disableSnapshot` just disables; there is **no reviewer waive** in the build review UI (Approve/Reject only) — mark `flaky-test`/`flakyTest` in code or fix the test.

## How parameters are discovered

Storybook 8's `index.json` (v5) omits `parameters`; StoryShelf prefers `stories.json` (which has them) then falls back to runtime `page.evaluate(() => __STORYBOOK_PREVIEW__.extract()[id].parameters)` for SB 8 without `buildStoriesJson`.

You **do not** need to edit `.storybook/main.ts`. When `storyshelf upload` builds Storybook for you, it sets `STORYBOOK_BUILD_STORIES_JSON=true` automatically. If you build outside `upload` (`storybook build -o storybook-static` then `upload` without rebuild), the runtime fallback still covers it. For a persistent file, you may add:

```ts
// .storybook/main.ts
export default {
  // ...
  features: { buildStoriesJson: true },
};
```

## Build status and GitHub

- **Blocking `play` failure** (`!flaky`) → `build.status='failed'`, GitHub status `failure`, PR blocked.
- **Flaky failure** (`flaky-test`/`flakyTest`) → `build.status` stays `reviewing`/`approved` (visual diff decides), GitHub status `success` with a warning comment `⚠️ flaky story failed — not blocking`, UI shows a warning banner/badge.
- **Disabled** → not counted in `snapshotCount`, no baseline update.

Retry a flaky capture with **Retry** on the build page (`POST /api/v1/projects/:slug/builds/:id/retry`).

See **Project settings → Tests** for the toggle, **ADR 0017** for the full decision, and **Configuration** for `buildStoriesJson` details.
