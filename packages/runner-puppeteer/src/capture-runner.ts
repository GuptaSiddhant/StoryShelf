/** Puppeteer capture runner — composition root (factory wiring). */

import { createTargetOffers, type CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { recommendedNavigationTimeoutMs } from "@storyshelf/core/utils";
import { verifyLocalTargets } from "./availability.ts";
import { activeRuns, closeBrowser } from "./browser.ts";
import { launchLocal } from "./launch.ts";
import { renderAll } from "./pipeline.ts";
import { flattenBrowsers, type BrowserEntry, type LocalTarget } from "./targets.ts";
import type { ActiveRun, PuppeteerRenderInput } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Create a CaptureRunner that renders Storybook stories with Puppeteer (Chromium via chrome-headless-shell). */
export function createPuppeteerCaptureRunner(
  options: {
    /**
     * Every target the runner offers, default first (ADR 0007, decision 1): `"chromium"` or
     * `local(engine, { executablePath })`. Default `["chromium"]`. Chromium-family engines only; bare
     * `"chrome"` needs `local("chrome", { executablePath })`.
     */
    browsers?: readonly BrowserEntry[];
    /** The executable bare entries launch (`puppeteer-core` ships no browser). */
    executablePath?: string;
    /** Launch flags for local engines; replaces the default sandbox and low-memory flags. */
    args?: string[];
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
  const locals = flattenBrowsers(options.browsers ?? ["chromium"], options.executablePath);
  // Until `lifecycle.setup` verifies them, every declared engine reads as ready.
  const offers = createTargetOffers(
    locals.map(({ target }) => ({ target, reach: "loopback", status: "ready" })),
  );
  const launch = offers.guard(
    async (target) =>
      await launchLocal(
        locals.find((entry) => entry.target === target) as LocalTarget,
        options.args,
      ),
  );
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
      name: "Puppeteer",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "Puppeteer capture runner (chrome-headless-shell)",
      kind: "puppeteer",
      category: "capture-runner",
      get targets() {
        return offers.current();
      },
    },
    lifecycle: offers.lifecycle(async () => await Promise.resolve(verifyLocalTargets(locals))),
    async render(input: PuppeteerRenderInput) {
      const active: ActiveRun = { cancelled: false, browser: null };
      const remove = activeRuns.add(input.buildId, input.runId, active);
      try {
        return await renderAll(
          { concurrency, navigationTimeoutMs, recycleBrowserEvery, reusePages, ...input },
          active,
          launch,
          offers.defaultTarget,
        );
      } finally {
        remove();
      }
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
export type { PuppeteerRenderInput, RuntimeParamsState } from "./types.ts";
export { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";
