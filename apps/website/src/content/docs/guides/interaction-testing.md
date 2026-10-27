---
title: Interaction testing
description: Run Storybook play functions before screenshots — opt-in per project, with flaky and disable controls.
---

StoryShelf can run your Storybook `play` functions before each screenshot. When enabled, a failing `play` blocks the build (`failed`) so you can drop a separate `storybook test` / `vitest` CI job. Flaky stories can be marked non-blocking.

## Enable it (opt-in)

Interaction tests are **off by default**; with them off, a screenshot still waits for Storybook to report the story rendered (see below).

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

The runner does `page.goto(iframe.html?id=...&viewMode=story)` → `waitForSelector(#storybook-root, attached)` → wait for Storybook's render-finished event → _if enabled_ `page.evaluate(executePlay)` with `playTimeoutMs` → `screenshot({animations: disabled})`. No code change in `.storybook/main.ts` is required.

### When the screenshot is taken

The runner subscribes to the preview's channel before the story renders and waits for Storybook's own signal (`storyRendered`, or the error event of a story that fails to render) instead of a fixed sleep. After the signal it lets web fonts load and two frames paint (at most 250 ms), then waits `delay` if you set one. If StoryShelf runs `play` explicitly, it does so after this wait and before the screenshot. A story with no `delay` therefore no longer waits a fixed 500 ms, and a slow story is waited for until it is done.

If the page never sends the signal (a Storybook without the channel, or a story that never finishes rendering), the runner falls back to the earlier behaviour: after 5 seconds (the play timeout, when plays run and it is longer) it waits `delay ?? 500` ms and takes the screenshot, and the log notes that the story did not signal. A story that throws while rendering or in `play` is still photographed; one log line names the render phase and Storybook's message.

## Per-story controls

StoryShelf reads `parameters` from the Storybook build. Both **chromatic** and **storyshelf** keys are supported; **`storyshelf` wins** on conflict so existing Chromatic users work unchanged.

| Parameter             | Where                                                                                         | Effect                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `disableSnapshot`     | `parameters: { storyshelf: { disableSnapshot: true } }` or `chromatic:{disableSnapshot:true}` | Skip capture + play entirely — not counted, no `failed`                                                                                 |
| `flakyTest`           | `parameters: { storyshelf: { flakyTest: true } }` or `chromatic:{flakyTest:true}`             | Failure is **non-blocking**: build stays `reviewing`/`approved`, UI shows warning, GitHub status stays `success` with a warning comment |
| `delay`               | `parameters: { storyshelf: { delay: 300 } }`                                                  | Extra wait (ms) after Storybook reports the story rendered, before the screenshot (no extra wait when unset; 500 only as the fallback)  |
| `diffThreshold`       | `parameters: { storyshelf: { diffThreshold: 0.2 } }`                                          | Per-story `pixelThreshold` override (0–1)                                                                                               |
| `pauseAnimationAtEnd` | `parameters: { storyshelf: { pauseAnimationAtEnd: true } }`                                   | Pause CSS animations before screenshot; otherwise `animations:"disabled"`                                                               |

Tags are story-level and case-insensitive. Whole-story non-blocking:

```ts
// via tags (works even when index.json has no parameters)
export const Flaky: Story = {
  tags: ["flaky-test"],
  play: async () => {
    throw new Error("flake");
  },
};

// via parameters (both keys work)
export const FlakyParam: Story = {
  parameters: { storyshelf: { flakyTest: true } },
  play: async () => {
    throw new Error("flake");
  },
};
export const ChromaticFlaky: Story = {
  parameters: { chromatic: { flakyTest: true } },
  play: async ({ canvasElement }) => {
    /* ... */
  },
};

export const Hidden: Story = {
  parameters: { storyshelf: { disableSnapshot: true } },
  // or tags: ["skip"] — also disables via isDisabledStory
};
```

`disableSnapshot` just disables; there is **no reviewer waive** in the build review UI (Approve/Reject only) — mark `flaky-test`/`flakyTest` in code or fix the test.

## Storybook 10 `.test()` entries

Storybook 10's CSF-Next `story.test("name", async ({ canvas, userEvent }) => { ... })` adds a test to a story. Write it as a statement of its own, not an exported call (Storybook's indexer does not see the latter):

```ts
Primary.test("renders its label", async ({ canvas }) => {
  await expect(canvas.getByRole("button")).toHaveTextContent("Button");
});
```

Each test is an index entry with `subtype: "test"`. StoryShelf never screenshots them, and by default ignores them. Under **Settings → Tests** check **Run Storybook tests (.test())** (`runTests`, default **off**, also on the project API) and each test runs once per build, in the same browser as the project's primary target: the runner opens the test's own iframe URL, Storybook renders the story and runs the test body, and the runner reads pass or fail from Storybook's events (a body that throws, a story that fails to render, or no finish within the play timeout fails the test).

- A failing test fails the build, exactly like a failing `play`; a test of a `flaky-test` story does not, and the tests of a story marked `skip` or `disableSnapshot` are not run.
- The build page shows a **Storybook tests** card: failures first with their message, passes behind a disclosure. The same results are in the `testResults` JSON of the build on the API.
- Tests take no screenshot, write no baseline and add no build status. Storybook 8 and 9 have no test entries, so the setting does nothing there. Tests run on every build, also with affected capture.

## How parameters are discovered

For the background on the preview page this reads from, see [How Storybook works](/concepts/how-storybook-works/).

StoryShelf reads the story index from `stories.json` when available, otherwise `index.json`. If an entry includes parameters, StoryShelf uses them. When it does not, the runner reads the resolved story parameters from the preview's `__STORYBOOK_PREVIEW__.extract()` once per capture run. The Storybook 8, 9, and 10 fixtures use an `index.json` that omits parameters, so this runtime extraction supplies them.

You **do not** need to edit `.storybook/main.ts`. When `storyshelf upload` builds Storybook, it sets `STORYBOOK_BUILD_STORIES_JSON=true`; whether a build emits `stories.json` depends on Storybook's version and configuration. A build without that file uses `index.json` and runtime extraction instead.

## Build status and GitHub

- **Blocking `play` failure** (`!flaky`) → `build.status='failed'`, GitHub status `failure`, PR blocked.
- **Flaky failure** (`flaky-test`/`flakyTest`) → `build.status` stays `reviewing`/`approved` (visual diff decides), GitHub status `success` with a warning comment `⚠️ flaky story failed — not blocking`, UI shows a warning banner/badge.
- **Disabled** → not counted in `snapshotCount`, no baseline update.

Retry a flaky capture with **Retry** on the build page (`POST /api/v1/projects/:slug/builds/:id/retry`).

See **Project settings → Tests** for the toggle and **ADR 0017** for the full decision.
