/** One story captured by switching inside a loaded page (ADR 0052, decisions 3 and 4). */

import type { StoryEntry, Viewport } from "@storyshelf/core/adapter/capture-runner";
import type { Page } from "playwright-core";
import { QUIET_MS, type RequestTracker } from "./network-quiet.ts";
import { clearBrowserState } from "./pages.ts";
import { runtimeParametersForStory } from "./runtime-params.ts";
import { finishCapture, type CaptureOutcome, type SessionEnd } from "./screenshot.ts";
import { awaitPaint, settleTimeoutOf, waitForSettled, type SettleReport } from "./settle.ts";
import { inPageFontsReady, inPageSwitch, inPageTidy, type DocumentDrift } from "./switch-page.ts";
import type { CaptureContext, RuntimeParamsPage } from "./types.ts";

/** Why a session ended before a story: something the last capture left, or the story itself. */
export type SwitchEnd = SessionEnd | DocumentDrift | "quiet";

/**
 * Undo what the runner changed for the last capture and check the document is as served
 * (decision 4): the viewport size, the pointer, storage and cookies, then the in-page tidy.
 * Resolves to why the page may not be switched from, or null when it may.
 */
export async function prepareSwitch(page: Page, viewport: Viewport): Promise<DocumentDrift | null> {
  const size = page.viewportSize();
  if (size?.width !== viewport.width || size.height !== viewport.height) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
  }
  await page.mouse.move(0, 0);
  await page.evaluate(clearBrowserState);
  await page.context().clearCookies();
  return await page.evaluate(inPageTidy);
}

/**
 * Switch the loaded page to `inputStory` and capture it. Only a story that settles on its own
 * events, with no error, and then goes network-quiet is captured: anything else resolves to the
 * reason, and the caller captures the story again on a fresh page.
 */
export async function captureSwitched(
  page: Page,
  ctx: CaptureContext,
  inputStory: StoryEntry,
  viewport: Viewport,
  requests: RequestTracker,
): Promise<CaptureOutcome | SwitchEnd> {
  const story = await withParameters(ctx, page, inputStory);
  if (story.parameters?.isolate === true) return "isolate";
  if (story.parameters?.pauseAnimationAtEnd === true) return "paused";
  const timeoutMs = settleTimeoutOf(ctx);
  const report = await switchAndSettle(page, story.id, timeoutMs, requests);
  if (typeof report === "string") return report;
  await page.evaluate(inPageFontsReady, timeoutMs);
  await awaitPaint(page);
  if (story.parameters?.delay !== undefined) await page.waitForTimeout(story.parameters.delay);
  return await finishCapture(ctx, page, story, viewport, report);
}

/**
 * Ask Storybook for the story and wait for it: its own events with no error, then network quiet
 * (no navigation waited for its images and lazy chunks). Resolves to the report, or why not.
 */
async function switchAndSettle(
  page: Page,
  storyId: string,
  timeoutMs: number,
  requests: RequestTracker,
): Promise<SettleReport | SwitchEnd> {
  if (!(await page.evaluate(inPageSwitch, storyId))) return "failed";
  const report = await waitForSettled(page, timeoutMs);
  const problem = report.renderError ?? report.playError ?? report.unhandled?.[0];
  if (!report.settled || problem !== undefined) return "failed";
  return (await requests.quiet(QUIET_MS, timeoutMs)) ? report : "quiet";
}

/** The story with its parameters, read once per run from the preview this page already loaded. */
async function withParameters(
  ctx: CaptureContext,
  page: Page,
  story: StoryEntry,
): Promise<StoryEntry> {
  if (story.parameters) return story;
  const rpPage = page as unknown as RuntimeParamsPage;
  const params = await runtimeParametersForStory(ctx.runtimeParams, rpPage, story.id);
  return params ? { ...story, parameters: params } : story;
}
