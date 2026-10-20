/** Playwright capture runner — composition root (factory wiring). */

import {
  BROWSER_NAMES,
  type BrowserName,
  type CaptureRunner,
} from "@storyshelf/core/adapter/capture-runner";
import { recommendedNavigationTimeoutMs } from "@storyshelf/core/utils";
import { activeRuns, closeBrowser } from "./browser.ts";
import { extractAll, renderAll } from "./pipeline.ts";
import type { ActiveRun, ExtractInput, PlaywrightRenderInput } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Create a CaptureRunner that renders Storybook stories with Playwright. */
export function createPlaywrightCaptureRunner(
  options: {
    browser?: BrowserName;
    supportedBrowsers?: readonly BrowserName[];
    /** Pages rendered at once; falls back to `STORYSHELF_CAPTURE_CONCURRENCY`, then CPU/memory detection. */
    concurrency?: number;
    /** Per-page timeout in ms; falls back to `STORYSHELF_NAVIGATION_TIMEOUT_MS`, then CPU detection. */
    navigationTimeoutMs?: number;
    /** Captures between browser restarts (0 disables); falls back to `STORYSHELF_BROWSER_RECYCLE_EVERY`, then 150. */
    recycleBrowserEvery?: number;
    /** Reuse pages between captures (opt-in); falls back to `STORYSHELF_REUSE_PAGES=1`. */
    reusePages?: boolean;
  } = {},
): CaptureRunner {
  const defaultBrowser = options.browser ?? "chromium";
  const concurrency = options.concurrency ?? envPositiveInt("STORYSHELF_CAPTURE_CONCURRENCY");
  const navigationTimeoutMs =
    options.navigationTimeoutMs ??
    envPositiveInt("STORYSHELF_NAVIGATION_TIMEOUT_MS") ??
    recommendedNavigationTimeoutMs();
  const recycleBrowserEvery =
    options.recycleBrowserEvery ?? envInt("STORYSHELF_BROWSER_RECYCLE_EVERY", 0);
  const reusePages =
    options.reusePages ?? ["1", "true"].includes(process.env["STORYSHELF_REUSE_PAGES"] ?? "");
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
      const remove = activeRuns.add(input.buildId, input.runId, active);
      try {
        return await renderAll(
          { concurrency, navigationTimeoutMs, recycleBrowserEvery, reusePages, ...input },
          active,
          defaultBrowser,
        );
      } finally {
        remove();
      }
    },
    async extractParameters(input: ExtractInput) {
      return await extractAll(input, defaultBrowser);
    },
    async cancel(buildId, runId) {
      await Promise.all(
        activeRuns.matching(buildId, runId).map(async (active) => {
          active.cancelled = true;
          await closeBrowser(active.browser);
        }),
      );
    },
  };
}

function envPositiveInt(name: string): number | undefined {
  return envInt(name, 1);
}

function envInt(name: string, min: number): number | undefined {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return parsed >= min ? parsed : undefined;
}

// Re-exports for backward compatibility (tests import these from capture-runner).
export type { PlaywrightRenderInput, RuntimeParamsState } from "./types.ts";
export { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";
