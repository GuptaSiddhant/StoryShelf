/** Screenshot pipeline for a single story + viewport. */

import type { StoryEntry, Viewport } from "@storyshelf/core/adapter/capture-runner";
import { getScreenshotPlan } from "@storyshelf/core/capture";
import type { Page } from "playwright-core";
import { checkA11y } from "./a11y.ts";
import { acquirePage } from "./pages.ts";
import { runPlay } from "./play.ts";
import { runtimeParametersForStory } from "./runtime-params.ts";
import { awaitPaint, settleTimeoutOf, waitForSettled, type SettleReport } from "./settle.ts";
import type { CaptureContext, RuntimeParamsPage } from "./types.ts";

/** Capture a screenshot for one story/viewport, returning buffer + a11y violations. */
export async function captureScreenshot(
  ctx: CaptureContext,
  inputStory: StoryEntry,
  viewport: Viewport,
): Promise<{ screenshot: Buffer; a11yViolations: string[]; story: StoryEntry }> {
  const lease = await acquirePage(ctx, viewport);
  let reusable = false;
  if (ctx.navigationTimeoutMs) lease.page.setDefaultTimeout(ctx.navigationTimeoutMs);
  try {
    const result = await runCapture(lease.page, ctx, inputStory, viewport);
    reusable = true;
    return result;
  } finally {
    await lease.release(reusable);
  }
}

async function runCapture(
  page: Page,
  ctx: CaptureContext,
  inputStory: StoryEntry,
  viewport: Viewport,
): Promise<{ screenshot: Buffer; a11yViolations: string[]; story: StoryEntry }> {
  const story = await navigateAndEnrich(ctx, page, inputStory, viewport);
  await waitUntilReady(ctx, page, story);
  if (ctx.executePlay) await runPlay(page, story.id, ctx.playTimeoutMs ?? 10_000);
  const a11yViolations = await getA11y(ctx, page);
  await settlePage(page, story);
  const plan = await resolvePlan(page, viewport, story);
  if (plan.viewport.width !== viewport.width || plan.viewport.height !== viewport.height)
    await page.setViewportSize(plan.viewport);
  const screenshot = await burstShots(page, plan, story);
  return { screenshot, a11yViolations, story };
}

async function navigateAndEnrich(
  ctx: CaptureContext,
  page: Page,
  story: StoryEntry,
  viewport: Viewport,
): Promise<StoryEntry> {
  await page.goto(ctx.adapter.buildUrl(ctx.baseUrl, story.id, viewport.globals), {
    waitUntil: "networkidle",
  });
  await ctx.adapter.waitForReady?.(page);
  if (story.parameters) return story;
  const rpPage = page as unknown as RuntimeParamsPage;
  const params = await runtimeParametersForStory(ctx.runtimeParams, rpPage, story.id);
  return params ? { ...story, parameters: params } : story;
}
/**
 * Wait until the story is ready to be photographed: the selector exists, then Storybook says the
 * render (and its play function) finished, then an explicit `parameters.delay` runs on top. A page
 * that never signals (no channel, or no event before the timeout) gets today's fixed wait instead:
 * `delay ?? 500` ms.
 */
async function waitUntilReady(ctx: CaptureContext, page: Page, story: StoryEntry): Promise<void> {
  if (!ctx.adapter.screenshotSelector) return;
  await page.waitForSelector(ctx.adapter.screenshotSelector, { state: "attached" });
  const report = await waitForSettled(page, settleTimeoutOf(ctx));
  if (report.settled) {
    await awaitPaint(page);
    if (story.parameters?.delay !== undefined) await page.waitForTimeout(story.parameters.delay);
  } else {
    await page.waitForTimeout(story.parameters?.delay ?? 500);
  }
  logSettle(ctx, story, report);
  if (story.parameters?.pauseAnimationAtEnd) {
    await page.evaluate(() => {
      const doc = globalThis.document as unknown as {
        getAnimations: () => { pause: () => void }[];
      };
      for (const anim of doc.getAnimations()) anim.pause();
    });
  }
}

/** One line per story that did not render cleanly: where it stopped, and what Storybook said. */
function logSettle(ctx: CaptureContext, story: StoryEntry, report: SettleReport): void {
  const problem = report.renderError ?? report.playError ?? report.unhandled?.[0];
  if (report.settled && problem === undefined) return;
  const detail = { storyId: story.id, phase: report.phase, waitedMs: report.elapsedMs, problem };
  if (!report.settled && report.hooked) {
    ctx.logger?.warn(detail, "story did not signal that it finished rendering; used a fixed wait");
  } else if (problem !== undefined) {
    ctx.logger?.warn(detail, "story reported an error while rendering");
  }
}
async function getA11y(ctx: CaptureContext, page: Page): Promise<string[]> {
  // checkA11y reports its own failures as an annotation, so it never throws.
  return ctx.runA11y ? await checkA11y(page, ctx.logger) : [];
}
async function settlePage(page: Page, story: StoryEntry): Promise<void> {
  const burst = story.parameters?.burst ?? 1;
  const waitFonts = story.parameters?.waitForFonts ?? burst > 1;
  if (waitFonts) {
    try {
      await page.evaluate(async () => {
        await (globalThis as unknown as { document: { fonts: { ready: Promise<void> } } }).document
          .fonts.ready;
      });
    } catch {
      // best-effort
    }
  }
  try {
    await page.evaluate(() => {
      for (const vid of (globalThis as unknown as { document: Document }).document.querySelectorAll(
        "video",
      ))
        // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- narrow to HTMLVideoElement
        (vid as unknown as HTMLVideoElement).pause();
    });
  } catch {
    // best-effort
  }
}
async function resolvePlan(
  page: Page,
  viewport: Viewport,
  story: StoryEntry,
): Promise<ReturnType<typeof getScreenshotPlan>> {
  const box = await page
    .locator("#storybook-root")
    .boundingBox()
    .catch(() => null);
  return getScreenshotPlan(viewport, box, {
    autoCrop: story.parameters?.autoCrop,
    whitespaceThreshold: story.parameters?.autoCropThreshold,
    fullPageOnOverflow: story.parameters?.fullPageOnOverflow,
    minWidth: story.parameters?.minWidth,
    minHeight: story.parameters?.minHeight,
    maxWidth: story.parameters?.maxWidth,
    maxHeight: story.parameters?.maxHeight,
  });
}
async function burstShots(
  page: Page,
  plan: ReturnType<typeof getScreenshotPlan>,
  story: StoryEntry,
): Promise<Buffer> {
  const count = Math.max(1, Math.min(5, story.parameters?.burst ?? 1));
  const shots: Buffer[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential burst
      await page.waitForTimeout(100);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential burst
    shots.push(await shotOne(page, plan, story));
  }
  const preferred = shots[Math.floor(shots.length / 2)] ?? shots[0];
  if (preferred) return preferred;
  const fallback: unknown = await page.screenshot({
    animations: story.parameters?.pauseAnimationAtEnd ? "allow" : "disabled",
    ...(plan.fullPage ? { fullPage: true } : {}),
    ...(plan.clip ? { clip: plan.clip } : {}),
  });
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- Buffer narrowing
  return fallback as unknown as Buffer;
}
async function shotOne(
  page: Page,
  plan: ReturnType<typeof getScreenshotPlan>,
  story: StoryEntry,
): Promise<Buffer> {
  const shot: unknown = await page.screenshot({
    animations: story.parameters?.pauseAnimationAtEnd ? "allow" : "disabled",
    ...(plan.fullPage ? { fullPage: true } : {}),
    ...(plan.clip ? { clip: plan.clip } : {}),
  });
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- Buffer narrowing
  return shot as unknown as Buffer;
}
