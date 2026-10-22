/** Measuring a remote browser's environment from inside it (ADR 0007, decision 2). */
import type { CaptureEnvironment, RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import {
  FONT_PROBE_FAMILIES,
  inPageProbe,
  remoteEnvironment,
  type BrowserProbe,
} from "@storyshelf/core/utils";
import type { Browser } from "puppeteer-core";
import { messageOf } from "./browser.ts";

/**
 * The fingerprint of the browser a render drove: its version, and what a blank page in it reports
 * (OS, pixel ratio, installed fonts). Never `process.platform` or `fc-list`, which describe this
 * host. A page that cannot be probed leaves those fields out, and an unknown component is not a
 * change (ADR 0005), so a service outage here cannot rewrite baselines.
 */
export async function measureRemote(
  browser: Browser,
  remote: RemoteBrowser,
  logger?: Logger,
): Promise<CaptureEnvironment> {
  return remoteEnvironment({
    browserVersion: await versionOf(browser),
    probe: await probeBlankPage(browser, logger),
    declaredPlatform: remote.platform,
  });
}

async function versionOf(browser: Browser): Promise<string | undefined> {
  try {
    return typeof browser.version === "function" ? await browser.version() : undefined;
  } catch {
    return undefined;
  }
}

async function probeBlankPage(
  browser: Browser,
  logger?: Logger,
): Promise<BrowserProbe | undefined> {
  try {
    const page = await browser.newPage();
    try {
      return await page.evaluate(inPageProbe, [...FONT_PROBE_FAMILIES]);
    } finally {
      await page.close();
    }
  } catch (error) {
    logger?.warn({ reason: messageOf(error) }, "could not measure the remote browser");
    return undefined;
  }
}
