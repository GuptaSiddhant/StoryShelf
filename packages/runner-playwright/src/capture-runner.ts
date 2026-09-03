import { chromium, type Browser } from "playwright";

import {
  StorybookAdapter,
  type CaptureRunner,
  type RenderResult,
  type RenderedSnapshot,
  type StoryEntry,
  type StorySourceAdapter,
  type Viewport,
} from "@storyshelf/core";
import type { Logger } from "@storyshelf/core/types";

declare const __PKG_VERSION__: string | undefined;

import { createStaticServer } from "./static-server.ts";

interface ScreenshotContext {
  browser: Browser;
  adapter: StorySourceAdapter;
  baseUrl: string;
}

/** A render that may currently be in flight, so that `cancel` can abort it. */
interface ActiveRun {
  cancelled: boolean;
  browser: Browser | null;
}

const activeRuns = new Map<string, ActiveRun>();

export interface PlaywrightRenderInput {
  buildId: string;
  storybookDir: string;
  stories: StoryEntry[];
  viewports: Viewport[];
  logger?: Logger;
}

export function createPlaywrightCaptureRunner(): CaptureRunner {
  return {
    metadata: {
      name: "Playwright",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Playwright capture runner",
      kind: "playwright",
    },
    async render(input: PlaywrightRenderInput) {
      const active: ActiveRun = { cancelled: false, browser: null };
      activeRuns.set(input.buildId, active);
      try {
        return await renderAll(input, active);
      } finally {
        activeRuns.delete(input.buildId);
      }
    },
    async cancel(buildId) {
      const active = activeRuns.get(buildId);
      if (!active) {
        return;
      }
      active.cancelled = true;
      await closeBrowser(active.browser);
    },
  };
}

async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) {
    return;
  }
  try {
    await browser.close();
  } catch {
    // The run's own `finally` performs final cleanup; cancel must never throw.
  }
}

async function renderAll(input: PlaywrightRenderInput, active: ActiveRun): Promise<RenderResult> {
  const server = await createStaticServer(input.storybookDir);
  const browser = await chromium.launch();
  active.browser = browser;
  const adapter = new StorybookAdapter();
  const ctx: ScreenshotContext = { browser, adapter, baseUrl: server.url };
  const captures: RenderedSnapshot[] = [];
  const failures: RenderResult["failures"] = [];
  try {
    const tasks = input.viewports.flatMap((viewport) =>
      input.stories.map(async (story) => {
        if (active.cancelled) {
          throw new Error("Capture cancelled");
        }
        try {
          const screenshot = await captureScreenshot(ctx, story, viewport);
          captures.push({ story, viewportName: viewport.name, screenshot });
        } catch (error) {
          failures.push({ storyId: story.id, viewportName: viewport.name, error: messageOf(error) });
          input.logger?.error({ storyId: story.id, viewport: viewport.name, err: error }, "render failed for story");
        }
      }),
    );
    await Promise.all(tasks);
    return { captures, failures };
  } finally {
    active.browser = null;
    await Promise.all([safeCloseBrowser(browser), safeCloseServer(server)]);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeCloseBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Already closed by `cancel`; the run must complete without throwing.
  }
}

async function safeCloseServer(server: { close(): Promise<void> }): Promise<void> {
  try {
    await server.close();
  } catch {
    // Best-effort; teardown must never mask a render result.
  }
}

async function captureScreenshot(ctx: ScreenshotContext, story: StoryEntry, viewport: Viewport): Promise<Buffer> {
  const page = await ctx.browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    await page.goto(ctx.adapter.buildUrl(ctx.baseUrl, story.id), { waitUntil: "networkidle" });
    if (ctx.adapter.screenshotSelector) {
      await page.waitForSelector(ctx.adapter.screenshotSelector, { state: "attached" });
      // Storybook may initially render the root as hidden; wait briefly for the story to paint.
      await page.waitForTimeout(500);
    }
    return await page.screenshot();
  } finally {
    await page.close();
  }
}
