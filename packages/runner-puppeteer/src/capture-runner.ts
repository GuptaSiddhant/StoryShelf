/** Puppeteer capture runner — composition root (factory wiring). */

import type { BrowserName, CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { activeRuns, closeBrowser } from "./browser.ts";
import { renderAll } from "./pipeline.ts";
import type { ActiveRun, PuppeteerRenderInput } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Create a CaptureRunner that renders Storybook stories with Puppeteer (Chromium via chrome-headless-shell). */
export function createPuppeteerCaptureRunner(
  options: {
    browser?: BrowserName;
    supportedBrowsers?: readonly BrowserName[];
    executablePath?: string;
    args?: string[];
  } = {},
): CaptureRunner {
  return {
    metadata: {
      name: "Puppeteer",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Puppeteer capture runner (chrome-headless-shell)",
      kind: "puppeteer",
      category: "capture-runner",
      supportedBrowsers: options.supportedBrowsers ?? ["chromium", "chrome"],
    },
    async render(input: PuppeteerRenderInput) {
      const active: ActiveRun = { cancelled: false, browser: null };
      activeRuns.set(input.buildId, active);
      try {
        return await renderAll(input, active, options);
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
export type { PuppeteerRenderInput, RuntimeParamsState } from "./types.ts";
export { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";
