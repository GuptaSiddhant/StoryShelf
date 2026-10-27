/** Playwright capture runner — composition root (factory wiring). */

import {
  createTargetOffers,
  shutdownRemote,
  type CaptureRunner,
  type RunnerTarget,
} from "@storyshelf/core/adapter/capture-runner";
import type { AdapterLifecycle } from "@storyshelf/core/adapter/metadata";
import { recommendedNavigationTimeoutMs } from "@storyshelf/core/utils";
import { verifyLocalTargets } from "./availability.ts";
import { activeRuns, closeBrowser } from "./browser.ts";
import { connectRemote } from "./connect.ts";
import { launchLocal, loadPlaywright } from "./launch.ts";
import { extractAll, renderAll } from "./pipeline.ts";
import { flattenBrowsers, type BrowserEntry, type LocalTarget } from "./targets.ts";
import { runTestEntries } from "./tests.ts";
import type {
  ActiveRun,
  ExtractInput,
  PlaywrightRenderInput,
  PlaywrightTestsInput,
  TargetDriver,
} from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/** Create a CaptureRunner that renders Storybook stories with Playwright. */
export function createPlaywrightCaptureRunner(
  options: {
    /**
     * Every target the runner offers, default first (ADR 0007, decision 1): engine names,
     * `local(engine, options)`, or remote services from `@storyshelf/runner-playwright/remote`
     * (`<engine>@<name>` targets). Default `["chromium"]`; Firefox and WebKit are offered only when
     * listed, and their binaries provisioned (`playwright install`), which `playwright-core` never
     * does. A list with no local entry needs no installed browsers.
     */
    browsers?: readonly BrowserEntry[];
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
  const { declared, locals, remotes } = flattenBrowsers(options.browsers ?? ["chromium"]);
  // Until `lifecycle.setup` verifies them, every declared target reads as ready.
  const offers = createTargetOffers(declared);
  const driver: TargetDriver = {
    launch: offers.guard(async (target, logger, context) => {
      const remote = remotes.find((entry) => entry.target === target);
      return remote
        ? await connectRemote(remote, context, logger)
        : await launchLocal(locals.find((entry) => entry.target === target) as LocalTarget);
    }),
    remote: (target) => remotes.find((entry) => entry.target === target),
  };
  const defaultTarget = offers.defaultTarget;
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
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "Playwright capture runner",
      kind: "playwright",
      category: "capture-runner",
      get targets() {
        return offers.current();
      },
    },
    lifecycle: withLeaseRelease(
      offers.lifecycle(async () => await verifyTargets(declared, locals)),
    ),
    async render(input: PlaywrightRenderInput) {
      const active: ActiveRun = { cancelled: false, browser: null, abort: new AbortController() };
      const remove = activeRuns.add(input.buildId, input.runId, active);
      try {
        return await renderAll(
          { concurrency, navigationTimeoutMs, recycleBrowserEvery, reusePages, ...input },
          active,
          driver,
          defaultTarget,
        );
      } finally {
        remove();
      }
    },
    async extractParameters(input: ExtractInput) {
      return await extractAll(input, driver, defaultTarget);
    },
    async runTests(input: PlaywrightTestsInput) {
      const active: ActiveRun = { cancelled: false, browser: null, abort: new AbortController() };
      const remove = activeRuns.add(input.buildId, input.runId, active);
      try {
        return await runTestEntries(
          { concurrency, navigationTimeoutMs, ...input },
          active,
          driver,
          defaultTarget,
        );
      } finally {
        remove();
      }
    },
    async cancel(buildId, runId) {
      await Promise.all(
        activeRuns.matching(buildId, runId).map(async (active) => {
          active.cancelled = true;
          active.abort?.abort();
          await closeBrowser(active.browser);
        }),
      );
    },
  };
}

/** Teardown also releases every lease still held, so a stopped process leaves no server running. */
function withLeaseRelease(lifecycle: AdapterLifecycle): AdapterLifecycle {
  return {
    ...lifecycle,
    teardown: async () => {
      await shutdownRemote();
      await lifecycle.teardown();
    },
  };
}

/** Local targets are checked for an installed engine; a remote one is not probed (that would open a session). */
async function verifyTargets(
  declared: readonly RunnerTarget[],
  locals: readonly LocalTarget[],
): Promise<RunnerTarget[]> {
  const checked = new Map(
    verifyLocalTargets(locals, await loadPlaywright()).map((entry) => [entry.target, entry]),
  );
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
export type { PlaywrightRenderInput, RuntimeParamsState } from "./types.ts";
export { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";
