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
import type { Browser, Page } from "puppeteer-core";
import { messageOf } from "./browser.ts";
import type { BrowserSession } from "./session.ts";

/** What stops a measurement: the run's cancel signal, and where warnings go. */
export interface MeasureOptions {
  logger?: Logger | undefined;
  /** Aborted when the run is cancelled; the measurement then stops the run. */
  signal?: AbortSignal | undefined;
}

/**
 * The fingerprint of the browser a render drove: its version, and what a blank page in it reports
 * (OS, pixel ratio, installed fonts). Never `process.platform` or `fc-list`, which describe this
 * host. The whole measurement is bounded by `remote.timeouts.probeMs`: whatever could not be read
 * in time is left out with a warning, and an unknown component is not a change (ADR 0005), so a
 * service outage here cannot rewrite baselines. A cancel is not an outage: it throws
 * `Capture cancelled` so the run stops and is never stored as an unknown environment.
 */
export async function measureRemote(
  session: BrowserSession,
  remote: RemoteBrowser,
  options: MeasureOptions = {},
): Promise<CaptureEnvironment> {
  const seen: { version?: string | undefined; probe?: BrowserProbe | undefined } = {};
  let page: Page | undefined;
  const outcome = await boundedProbe({
    timeoutMs: remote.timeouts.probeMs,
    signal: options.signal,
    run: async ({ stopped }) => {
      seen.version = await versionOf(session.browser);
      const opened = await session.newPage();
      page = opened;
      if (stopped()) {
        throw new Error("the measurement stopped before its page opened");
      }
      seen.probe = await opened.evaluate(inPageProbe, [...FONT_PROBE_FAMILIES]);
    },
  });
  // Closed on every path; a page that opens after the limit is closed here too, once it is known.
  await closePage(session, page);
  if (outcome.status === "cancelled") {
    throw new Error("Capture cancelled");
  }
  warnUnlessDone(outcome, remote.timeouts.probeMs, options.logger);
  return remoteEnvironment({
    browserVersion: seen.version,
    probe: seen.probe,
    declaredPlatform: remote.platform,
  });
}

function warnUnlessDone(
  outcome: { status: "done" | "timeout" | "failed"; error?: unknown },
  timeoutMs: number,
  logger: Logger | undefined,
): void {
  if (outcome.status === "timeout") {
    logger?.warn(
      { timeoutMs },
      "measuring the remote browser timed out; its environment is unknown",
    );
  } else if (outcome.status === "failed") {
    logger?.warn({ reason: messageOf(outcome.error) }, "could not measure the remote browser");
  }
}

async function closePage(session: BrowserSession, page: Page | undefined): Promise<void> {
  if (page === undefined) return;
  await page.close().catch(() => {});
  session.forgetPage(page);
}

async function versionOf(browser: Browser): Promise<string | undefined> {
  try {
    return typeof browser.version === "function" ? await browser.version() : undefined;
  } catch {
    return undefined;
  }
}
