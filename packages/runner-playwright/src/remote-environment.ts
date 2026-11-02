/** Measuring a remote browser's environment from inside it (ADR 0007, decision 2). */
import type { CaptureEnvironment, RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import {
  FONT_PROBE_FAMILIES,
  boundedProbe,
  inPageProbe,
  remoteEnvironment,
  type BrowserProbe,
} from "@storyshelf/core/utils";
import type { Browser, Page } from "playwright-core";
import { messageOf } from "./browser.ts";

/** What stops a measurement: the run's cancel signal, and where warnings go. */
export interface MeasureOptions {
  logger?: Logger | undefined;
  /** Aborted when the run is cancelled; the measurement then stops the run. */
  signal?: AbortSignal | undefined;
}

/**
 * The fingerprint of the browser a render drove: its version, and what a blank page in it reports
 * (OS, pixel ratio, installed fonts). Never `process.platform` or `fc-list`, which describe this
 * host. The probe is bounded by `remote.timeouts.probeMs`: a page that cannot be probed, or that
 * overruns, leaves those fields out with a warning, and an unknown component is not a change
 * (ADR 0005), so a service outage here cannot rewrite baselines. A cancel is not an outage: it
 * throws `Capture cancelled` so the run stops and is never stored as an unknown environment.
 */
export async function measureRemote(
  browser: Browser,
  remote: RemoteBrowser,
  options: MeasureOptions = {},
): Promise<CaptureEnvironment> {
  return remoteEnvironment({
    browserVersion: typeof browser.version === "function" ? browser.version() : undefined,
    probe: await probeBlankPage(browser, remote.timeouts.probeMs, options),
    declaredPlatform: remote.platform,
  });
}

/**
 * Open a blank page, read the probe and close the page, within the limit. The page is closed on
 * every path: after a result, after a failure, and after a timeout or cancel, when the work that
 * opened it may still be pending (a page it opens late is closed by the work itself).
 */
async function probeBlankPage(
  browser: Browser,
  timeoutMs: number,
  options: MeasureOptions,
): Promise<BrowserProbe | undefined> {
  let page: Page | undefined;
  const outcome = await boundedProbe({
    timeoutMs,
    signal: options.signal,
    run: async ({ stopped }) => {
      const opened = await browser.newPage();
      page = opened;
      if (stopped()) {
        await opened.close().catch(() => {});
        throw new Error("the measurement stopped before its page opened");
      }
      return await opened.evaluate(inPageProbe, [...FONT_PROBE_FAMILIES]);
    },
  });
  await page?.close().catch(() => {});
  if (outcome.status === "done") {
    return outcome.value;
  }
  if (outcome.status === "cancelled") {
    throw new Error("Capture cancelled");
  }
  options.logger?.warn(
    outcome.status === "timeout" ? { timeoutMs } : { reason: messageOf(outcome.error) },
    outcome.status === "timeout"
      ? "measuring the remote browser timed out; its environment is unknown"
      : "could not measure the remote browser",
  );
  return undefined;
}
