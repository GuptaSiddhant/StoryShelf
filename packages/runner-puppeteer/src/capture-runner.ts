/** Puppeteer capture runner — composition root (factory wiring). */

import {
  createTargetOffers,
  shutdownRemote,
  type CaptureRunner,
  type RemoteTarget,
  type RunnerTarget,
} from "@storyshelf/core/adapter/capture-runner";
import type { AdapterLifecycle } from "@storyshelf/core/adapter/metadata";
import { verifyLocalTargets } from "./availability.ts";
import { cancelRuns, trackRun } from "./browser.ts";
import { connectRemote } from "./connect.ts";
import { launchLocal } from "./launch.ts";
import { renderAll } from "./pipeline.ts";
import { resolveSettings } from "./settings.ts";
import { flattenBrowsers, type BrowserEntry, type LocalTarget } from "./targets.ts";
import { runTestEntries } from "./tests.ts";
import type { PuppeteerRenderInput, PuppeteerTestsInput, TargetDriver } from "./types.ts";

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
    /** Reuse pages between captures (default on); falls back to `STORYSHELF_REUSE_PAGES`, where `0` or `false` turns it off. */
    reusePages?: boolean;
  } = {},
): CaptureRunner {
  const { declared, locals, remotes } = flattenBrowsers(
    options.browsers ?? ["chromium"],
    options.executablePath,
  );
  // Until `lifecycle.setup` verifies them, every declared target reads as ready.
  const offers = createTargetOffers(declared);
  const driver = buildDriver(offers, locals, remotes, options.args);
  const settings = resolveSettings(options);
  return {
    metadata: runnerMetadata(offers),
    lifecycle: withShutdown(
      offers.lifecycle(async () => await Promise.resolve(verifyTargets(declared, locals))),
    ),
    render: async (input: PuppeteerRenderInput) =>
      await trackRun(input, async (active) => {
        return await renderAll({ ...settings, ...input }, active, driver, offers.defaultTarget);
      }),
    runTests: async (input: PuppeteerTestsInput) =>
      await trackRun(input, async (active) => {
        const { concurrency, navigationTimeoutMs } = settings;
        return await runTestEntries(
          { concurrency, navigationTimeoutMs, ...input },
          active,
          driver,
          offers.defaultTarget,
        );
      }),
    cancel: cancelRuns,
  };
}

/** Launches a local engine or leases a remote one, whichever the target names. */
function buildDriver(
  offers: ReturnType<typeof createTargetOffers>,
  locals: readonly LocalTarget[],
  remotes: readonly RemoteTarget[],
  args: string[] | undefined,
): TargetDriver {
  return {
    launch: offers.guard(async (target, logger, context) => {
      const remote = remotes.find((entry) => entry.target === target);
      if (remote) {
        return await connectRemote(remote, context, logger);
      }
      const local = locals.find((entry) => entry.target === target);
      if (!local) {
        throw new Error(`No launchable target named ${target}`);
      }
      return { browser: await launchLocal(local, args), ownership: "launched" };
    }),
    remote: (target) => remotes.find((entry) => entry.target === target),
  };
}

function runnerMetadata(offers: ReturnType<typeof createTargetOffers>): CaptureRunner["metadata"] {
  return {
    name: "Puppeteer",
    version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
    description: "Puppeteer capture runner (chrome-headless-shell)",
    kind: "puppeteer",
    category: "capture-runner",
    get targets() {
      return offers.current();
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

/** Teardown also releases every lease still held and closes every pool, so a stopped process leaves no server running. */
function withShutdown(lifecycle: AdapterLifecycle): AdapterLifecycle {
  return {
    ...lifecycle,
    teardown: async () => {
      await shutdownRemote();
      await lifecycle.teardown();
    },
  };
}

// Re-exports for backward compatibility (tests import these from capture-runner).
export type { PuppeteerRenderInput, RuntimeParamsState } from "./types.ts";
export { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";
