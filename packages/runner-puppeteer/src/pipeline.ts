/** Render orchestration: static server, browser, and per-story captures. */

import type {
  RenderResult,
  RenderedSnapshot,
  StoryEntry,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter, resolveStoryViewports } from "@storyshelf/core/capture";
import { mapLimit, recommendedPageConcurrency } from "@storyshelf/core/utils";
import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import { messageOf, safeCloseBrowser, safeCloseServer } from "./browser.ts";
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
  return await runWithBrowser(input, active, browser, server);
}

async function runWithBrowser(
  input: PuppeteerRenderInput,
  active: ActiveRun,
  browser: Browser,
  server: Awaited<ReturnType<typeof createStaticServer>>,
): Promise<RenderResult> {
  active.browser = browser;
  const ctx = buildContext(browser, server.url, input);
  const captures: RenderedSnapshot[] = [];
  const failures: RenderResult["failures"] = [];
  try {
    await runAllCaptures(input, active, ctx, captures, failures);
    return { captures, failures };
  } finally {
    active.browser = null;
    await Promise.all([safeCloseBrowser(browser), safeCloseServer(server)]);
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
  };
}

async function runAllCaptures(
  input: PuppeteerRenderInput,
  active: ActiveRun,
  ctx: CaptureContext,
  captures: RenderedSnapshot[],
  failures: RenderResult["failures"],
): Promise<void> {
  // Bounded: one page per story x viewport all at once exhausts memory on large Storybooks.
  const jobs = input.stories.flatMap((story) =>
    resolveStoryViewports(story, input.viewports).map((viewport) => ({ story, viewport })),
  );
  await mapLimit(jobs, input.concurrency ?? recommendedPageConcurrency(), async (job) => {
    await captureOne(input, active, ctx, job.story, job.viewport, captures, failures);
  });
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
  captures.push({
    story: result.story,
    viewportName: viewport.name,
    viewport,
    screenshot: result.screenshot,
  });
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
