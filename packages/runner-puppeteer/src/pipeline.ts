/** Render orchestration: static server, browser, and per-story captures. */

import type {
  RenderResult,
  RenderedSnapshot,
  StoryEntry,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter, resolveStoryViewports } from "@storyshelf/core/capture";
import {
  DEFAULT_RECYCLE_BROWSER_EVERY,
  chunk,
  describeSizing,
  mapLimit,
  recommendedPageConcurrency,
} from "@storyshelf/core/utils";
import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import { messageOf, safeCloseBrowser, safeCloseServer } from "./browser.ts";
import { PagePool } from "./pages.ts";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { captureScreenshot } from "./screenshot.ts";
import { createStaticServer } from "./static-server.ts";
import type { ActiveRun, CaptureContext, PuppeteerRenderInput } from "./types.ts";

/** Render all story/viewport combinations for a build. */
export async function renderAll(
  input: PuppeteerRenderInput,
  active: ActiveRun,
  runnerOptions: { executablePath?: string; args?: string[] },
): Promise<RenderResult> {
  const server = await createStaticServer(input.storybookDir);
  const browser = await launchBrowser(runnerOptions);
  input.logger?.info(describeSizing(input), "capture sizing");
  return await runWithBrowser(
    input,
    active,
    browser,
    server,
    async () => await launchBrowser(runnerOptions),
  );
}

async function runWithBrowser(
  input: PuppeteerRenderInput,
  active: ActiveRun,
  browser: Browser,
  server: Awaited<ReturnType<typeof createStaticServer>>,
  relaunch: () => Promise<Browser>,
): Promise<RenderResult> {
  active.browser = browser;
  const ctx = buildContext(browser, server.url, input);
  const captures: RenderedSnapshot[] = [];
  const failures: RenderResult["failures"] = [];
  try {
    await runAllCaptures(input, active, ctx, captures, failures, relaunch);
    return { captures, failures };
  } finally {
    active.browser = null;
    await ctx.pagePool?.dispose();
    // ctx.browser is the latest one: recycling replaces the browser mid-run.
    await Promise.all([safeCloseBrowser(ctx.browser), safeCloseServer(server)]);
  }
}

/**
 * Sandbox flags for containers plus low-memory flags. Rendering-affecting flags
 * (`--disable-gpu`, `--single-process`) are excluded: they can shift pixels.
 */
const DEFAULT_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-background-networking",
  "--mute-audio",
];

async function launchBrowser(opts: { executablePath?: string; args?: string[] }): Promise<Browser> {
  return await puppeteer.launch({
    headless: true,
    executablePath: opts.executablePath,
    args: opts.args ?? DEFAULT_ARGS,
  });
}

function buildContext(
  browser: Browser,
  baseUrl: string,
  input: PuppeteerRenderInput,
): CaptureContext {
  return {
    browser,
    adapter: input.adapter ?? new StorybookAdapter(),
    baseUrl,
    navigationTimeoutMs: input.navigationTimeoutMs,
    executePlay: input.executePlay,
    playTimeoutMs: input.playTimeoutMs,
    runA11y: input.runA11y,
    runtimeParams: createRuntimeParamsState(),
    ...(input.reusePages ? { pagePool: new PagePool(browser) } : {}),
  };
}

async function runAllCaptures(
  input: PuppeteerRenderInput,
  active: ActiveRun,
  ctx: CaptureContext,
  captures: RenderedSnapshot[],
  failures: RenderResult["failures"],
  relaunch: () => Promise<Browser>,
): Promise<void> {
  // Bounded: one page per story x viewport all at once exhausts memory on large Storybooks.
  const jobs = input.stories.flatMap((story) =>
    resolveStoryViewports(story, input.viewports).map((viewport) => ({ story, viewport })),
  );
  // Batches drain in-flight pages, so the browser can be swapped between them.
  const batches = chunk(jobs, input.recycleBrowserEvery ?? DEFAULT_RECYCLE_BROWSER_EVERY);
  for (const [index, batch] of batches.entries()) {
    if (index > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- recycle only between drained batches
      await recycleBrowser(active, ctx, relaunch, input.logger);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- batches run one after another
    await mapLimit(batch, input.concurrency ?? recommendedPageConcurrency(), async (job) => {
      await captureOne(input, active, ctx, job.story, job.viewport, captures, failures);
    });
  }
}

/** Swap in a fresh browser; the old one is closed first so two never coexist. */
async function recycleBrowser(
  active: ActiveRun,
  ctx: CaptureContext,
  relaunch: () => Promise<Browser>,
  logger: PuppeteerRenderInput["logger"],
): Promise<void> {
  if (active.cancelled) throw new Error("Capture cancelled");
  await ctx.pagePool?.dispose();
  await safeCloseBrowser(ctx.browser);
  ctx.browser = await relaunch();
  if (ctx.pagePool) ctx.pagePool = new PagePool(ctx.browser);
  active.browser = ctx.browser;
  logger?.info({}, "browser recycled");
}

async function captureOne(
  input: PuppeteerRenderInput,
  active: ActiveRun,
  ctx: CaptureContext,
  story: StoryEntry,
  viewport: Viewport,
  captures: RenderedSnapshot[],
  failures: RenderResult["failures"],
): Promise<void> {
  if (active.cancelled) throw new Error("Capture cancelled");
  try {
    await pushCapture(ctx, story, viewport, captures, failures, input);
  } catch (error) {
    pushRenderFailure(failures, input, story.id, viewport.name, error);
  }
}

async function pushCapture(
  ctx: CaptureContext,
  story: StoryEntry,
  viewport: Viewport,
  captures: RenderedSnapshot[],
  failures: RenderResult["failures"],
  input: PuppeteerRenderInput,
): Promise<void> {
  const result = await captureScreenshot(ctx, story, viewport);
  const snapshot: RenderedSnapshot = {
    story: result.story,
    viewportName: viewport.name,
    viewport,
    screenshot: result.screenshot,
  };
  // Streaming: hand it over and drop the buffer rather than holding every screenshot.
  if (input.onCapture) await input.onCapture(snapshot);
  else captures.push(snapshot);
  if (result.a11yViolations.length > 0)
    handleA11y(input, failures, story, viewport, result.a11yViolations);
}
function handleA11y(
  input: PuppeteerRenderInput,
  failures: RenderResult["failures"],
  story: StoryEntry,
  viewport: Viewport,
  violations: string[],
): void {
  failures.push({
    storyId: story.id,
    viewportName: viewport.name,
    error: `a11y: ${violations.join("; ")}`,
  });
  input.logger?.warn(
    { storyId: story.id, viewport: viewport.name, violations },
    "a11y violations found",
  );
}

function pushRenderFailure(
  failures: RenderResult["failures"],
  input: PuppeteerRenderInput,
  storyId: string,
  viewportName: string,
  error: unknown,
): void {
  failures.push({ storyId, viewportName, error: messageOf(error) });
  input.logger?.error({ storyId, viewport: viewportName, err: error }, "render failed for story");
}
