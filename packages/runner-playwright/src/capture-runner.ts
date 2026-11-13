/** Playwright capture runner — composition root (factory wiring). */

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
import { launchLocal, loadPlaywright } from "./launch.ts";
import { extractAll, renderAll } from "./pipeline.ts";
import { resolveSettings } from "./settings.ts";
import { flattenBrowsers, type BrowserEntry, type LocalTarget } from "./targets.ts";
import { runTestEntries } from "./tests.ts";
import type {
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
    /** Reuse pages between captures (default on); falls back to `STORYSHELF_REUSE_PAGES`, where `0` or `false` turns it off. */
    reusePages?: boolean;
    /** Gzip small loopback Storybook assets when requested by the browser (default off). */
    staticCompression?: boolean;
  } = {},
): CaptureRunner {
  const { declared, locals, remotes } = flattenBrowsers(options.browsers ?? ["chromium"]);
  // Until `lifecycle.setup` verifies them, every declared target reads as ready.
  const offers = createTargetOffers(declared);
  const driver = buildDriver(offers, locals, remotes);
  const defaultTarget = offers.defaultTarget;
  const settings = resolveSettings(options);
  const { staticCompression } = options;
  return {
    metadata: runnerMetadata(offers),
    lifecycle: withLeaseRelease(
      offers.lifecycle(async () => await verifyTargets(declared, locals)),
    ),
    render: async (input: PlaywrightRenderInput) =>
      await trackRun(input, async (active) => {
        return await renderAll(
          { ...settings, ...input, staticCompression },
          active,
          driver,
          defaultTarget,
        );
      }),
    extractParameters: async (input: ExtractInput) =>
      await extractAll({ ...input, staticCompression }, driver, defaultTarget),
    runTests: async (input: PlaywrightTestsInput) =>
      await trackRun(input, async (active) => {
        const { concurrency, navigationTimeoutMs } = settings;
        return await runTestEntries(
          { concurrency, navigationTimeoutMs, ...input, staticCompression },
          active,
          driver,
          defaultTarget,
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
      return await launchLocal(local);
    }),
    remote: (target) => remotes.find((entry) => entry.target === target),
  };
}

function runnerMetadata(offers: ReturnType<typeof createTargetOffers>): CaptureRunner["metadata"] {
  return {
    name: "Playwright",
    version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
    description: "Playwright capture runner",
    kind: "playwright",
    category: "capture-runner",
    get targets() {
      return offers.current();
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

// Re-exports for backward compatibility (tests import these from capture-runner).
export type { PlaywrightRenderInput, RuntimeParamsState } from "./types.ts";
export { createRuntimeParamsState, runtimeParametersForStory } from "./runtime-params.ts";
