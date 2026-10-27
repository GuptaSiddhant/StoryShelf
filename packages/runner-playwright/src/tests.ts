/** Storybook 10 `.test()` entries run as interaction tests in the iframe (ADR 0004, decision 10). */

import {
  engineOf,
  type CaptureTarget,
  type StoryEntry,
  type TestOutcome,
} from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { createPageLimiter, isTimeoutError, type SessionGate } from "@storyshelf/core/utils";
import type { Browser, Page } from "playwright-core";
import { finishing, messageOf, outcomeOf, safeCloseBrowser, safeCloseServer } from "./browser.ts";
import { acquirePage } from "./pages.ts";
import { assertReachable, launchContextOf, planRun, serve } from "./pipeline.ts";
import { waitForSettled, type SettleReport } from "./settle.ts";
import type { ActiveRun, PlaywrightTestsInput, TargetDriver } from "./types.ts";

/** How long one test may take (render plus body) when the project sets nothing. */
export const DEFAULT_TEST_TIMEOUT_MS = 10_000;

/** A viewport for tests: they take no screenshot, so one size serves every entry. */
const TEST_VIEWPORT = { name: "test", width: 1280, height: 720 };

/** Run every test entry once and report pass or fail for each; a failing test never throws. */
export async function runTestEntries(
  rawInput: PlaywrightTestsInput,
  active: ActiveRun,
  driver: TargetDriver,
  defaultTarget: CaptureTarget,
): Promise<TestOutcome[]> {
  if (rawInput.tests.length === 0) return [];
  const { input, name, remote } = planRun(rawInput, driver, defaultTarget);
  assertReachable(name, remote, input.storybookUrl);
  const browser = await driver.launch(
    name,
    input.logger,
    launchContextOf(input, "tests", active.abort?.signal),
  );
  const server = await serve(input, browser);
  active.browser = browser;
  return await finishing(
    async () => await runAll(browser, server.url, input, active),
    async (failed, error) => {
      active.browser = null;
      await Promise.all([
        safeCloseBrowser(browser, outcomeOf(active, failed), error),
        safeCloseServer(server),
      ]);
    },
  );
}

async function runAll(
  browser: Browser,
  baseUrl: string,
  input: PlaywrightTestsInput & { target: CaptureTarget; gate?: SessionGate | undefined },
  active: ActiveRun,
): Promise<TestOutcome[]> {
  const outcomes = new Map<string, TestOutcome>();
  const pages = createPageLimiter({
    concurrency: input.concurrency,
    ...(input.gate === undefined ? {} : { gate: input.gate }),
    browser: engineOf(input.target),
    logger: input.logger,
  });
  try {
    await pages.each(input.tests, async (test) => {
      if (active.cancelled) throw new Error("Capture cancelled");
      const outcome = await runTestEntry(browser, baseUrl, test, input);
      outcomes.set(test.id, outcome);
      return outcome.timedOut === true;
    });
  } finally {
    pages.dispose();
  }
  return input.tests.flatMap((test) => outcomes.get(test.id) ?? []);
}

/** One test: open its iframe URL, let Storybook render and run it, then read the verdict. */
async function runTestEntry(
  browser: Browser,
  baseUrl: string,
  test: StoryEntry,
  input: PlaywrightTestsInput,
): Promise<TestOutcome & { timedOut?: boolean }> {
  const started = performance.now();
  const lease = await acquirePage({ browser }, TEST_VIEWPORT);
  let reusable = false;
  try {
    const report = await openAndWait(lease.page, baseUrl, test, input);
    reusable = true;
    const timeoutMs = input.playTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
    return verdictOf(test.id, report, timeoutMs, elapsedSince(started));
  } catch (error) {
    return crashed(test.id, error, elapsedSince(started));
  } finally {
    await lease.release(reusable);
  }
}

function elapsedSince(started: number): number {
  return Math.round(performance.now() - started);
}

/** The page or navigation failed before Storybook could say anything: the test failed. */
function crashed(
  storyId: string,
  error: unknown,
  durationMs: number,
): TestOutcome & { timedOut?: boolean } {
  return {
    storyId,
    status: "failed",
    error: messageOf(error),
    durationMs,
    timedOut: isTimeoutError(error),
  };
}

async function openAndWait(
  page: Page,
  baseUrl: string,
  test: StoryEntry,
  input: PlaywrightTestsInput,
): Promise<SettleReport> {
  if (input.navigationTimeoutMs) page.setDefaultTimeout(input.navigationTimeoutMs);
  const adapter = input.adapter ?? new StorybookAdapter();
  await page.goto(adapter.buildUrl(baseUrl, test.id), { waitUntil: "load" });
  return await waitForSettled(page, input.playTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS);
}

/** Read Storybook's own account of the run: a thrown play body or render error fails the test. */
export function verdictOf(
  storyId: string,
  report: SettleReport,
  timeoutMs: number,
  durationMs: number,
): TestOutcome & { timedOut?: boolean } {
  const failed = (error: string, timedOut = false): TestOutcome & { timedOut?: boolean } => ({
    storyId,
    status: "failed",
    error,
    durationMs,
    ...(timedOut ? { timedOut } : {}),
  });
  if (!report.hooked) return failed("Storybook's preview did not start (no channel to listen to)");
  if (report.renderError !== undefined) return failed(`render failed: ${report.renderError}`);
  if (report.playError !== undefined) return failed(report.playError);
  if (report.unhandled?.[0] !== undefined) return failed(report.unhandled[0]);
  if (!report.settled) {
    return failed(
      `test did not finish within ${timeoutMs}ms (phase: ${report.phase ?? "unknown"})`,
      true,
    );
  }
  return { storyId, status: "passed", durationMs };
}
