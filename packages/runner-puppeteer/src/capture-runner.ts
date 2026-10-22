/** Puppeteer capture runner — composition root (factory wiring). */

import {
  createTargetOffers,
  type CaptureRunner,
  type RunnerTarget,
} from "@storyshelf/core/adapter/capture-runner";
import { recommendedNavigationTimeoutMs } from "@storyshelf/core/utils";
import { verifyLocalTargets } from "./availability.ts";
import { activeRuns, closeBrowser } from "./browser.ts";
import { connectRemote } from "./connect.ts";
import { launchLocal } from "./launch.ts";
import { renderAll } from "./pipeline.ts";
import { flattenBrowsers, type BrowserEntry, type LocalTarget } from "./targets.ts";
import type { ActiveRun, PuppeteerRenderInput, TargetDriver } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Create a CaptureRunner that renders Storybook stories with Puppeteer (Chromium via chrome-headless-shell). */
export function createPuppeteerCaptureRunner(
  options: {
    /**
     * Every target the runner offers, default first (ADR 0007, decision 1): `"chromium"`,
     * `local(engine, { executablePath })`, or remote CDP services from
     * `@storyshelf/runner-puppeteer/remote` (`cdp(...)`: `<engine>@<name>` targets that need a
     * Storybook URL they can reach). Default `["chromium"]`. Chromium-family engines only; bare
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
  const { declared, locals, remotes } = flattenBrowsers(
    options.browsers ?? ["chromium"],
    options.executablePath,
  );
  // Until `lifecycle.setup` verifies them, every declared target reads as ready.
  const offers = createTargetOffers(declared);
  const driver: TargetDriver = {
    launch: offers.guard(async (target, logger) => {
      const remote = remotes.find((entry) => entry.target === target);
      return remote
        ? await connectRemote(remote, logger)
        : await launchLocal(
            locals.find((entry) => entry.target === target) as LocalTarget,
            options.args,
          );
    }),
    remote: (target) => remotes.find((entry) => entry.target === target),
  };
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
    lifecycle: offers.lifecycle(async () => await Promise.resolve(verifyTargets(declared, locals))),
    async render(input: PuppeteerRenderInput) {
      const active: ActiveRun = { cancelled: false, browser: null };
      const remove = activeRuns.add(input.buildId, input.runId, active);
      try {
        return await renderAll(
          { concurrency, navigationTimeoutMs, recycleBrowserEvery, reusePages, ...input },
          active,
          driver,
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

/** Local targets are checked for an executable; a remote one is not probed (that would open a session). */
function verifyTargets(
  declared: readonly RunnerTarget[],
  locals: readonly LocalTarget[],
): RunnerTarget[] {
  const checked = new Map(verifyLocalTargets(locals).map((entry) => [entry.target, entry]));
  return declared.map((entry) => checked.get(entry.target) ?? entry);
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
