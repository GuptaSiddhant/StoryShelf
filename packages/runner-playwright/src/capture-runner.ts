/** Playwright capture runner — composition root (factory wiring). */

import {
  BROWSER_NAMES,
  type BrowserName,
  type CaptureRunner,
} from "@storyshelf/core/adapter/capture-runner";
import { activeRuns, closeBrowser } from "./browser.ts";
import { renderAll } from "./pipeline.ts";
import type { ActiveRun, PlaywrightRenderInput } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Create a CaptureRunner that renders Storybook stories with Playwright. */
export function createPlaywrightCaptureRunner(
  options: {
    browser?: BrowserName;
    supportedBrowsers?: readonly BrowserName[];
  } = {},
): CaptureRunner {
  const defaultBrowser = options.browser ?? "chromium";
  return {
    metadata: {
      name: "Playwright",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Playwright capture runner",
      kind: "playwright",
      category: "capture-runner",
      supportedBrowsers: options.supportedBrowsers ?? BROWSER_NAMES,
    },
    async render(input: PlaywrightRenderInput) {
      const active: ActiveRun = { cancelled: false, browser: null };
      activeRuns.set(input.buildId, active);
      try {
        return await renderAll(input, active, defaultBrowser);
      } finally {
        activeRuns.delete(input.buildId);
      }
    },
    async cancel(buildId) {
      const active = activeRuns.get(buildId);
      if (!active) return;
      active.cancelled = true;
      await closeBrowser(active.browser);
    },
  };
}

// Re-exports for backward compatibility (tests import these from capture-runner).
export type { PlaywrightRenderInput, RuntimeParamsState } from "./types.ts";
export { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";
