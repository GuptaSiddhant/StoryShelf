import type {
  CaptureRunner,
  RenderResult,
  RenderedSnapshot,
  StoryEntry,
  StorySourceAdapter,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import { chromium, type Browser } from "playwright";

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

/** Input for a Playwright capture run over a built Storybook directory. */
export interface PlaywrightRenderInput {
  buildId: string;
  storybookDir: string;
  stories: StoryEntry[];
  viewports: Viewport[];
  logger?: Logger;
  executePlay?: boolean;
  playTimeoutMs?: number;
}

/** Create a CaptureRunner that renders Storybook stories with Playwright. */
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
  const ctx: ScreenshotContext & { executePlay?: boolean; playTimeoutMs?: number } = {
    browser,
    adapter,
    baseUrl: server.url,
    executePlay: input.executePlay,
    playTimeoutMs: input.playTimeoutMs,
  };
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
          failures.push({
            storyId: story.id,
            viewportName: viewport.name,
            error: messageOf(error),
          });
          input.logger?.error(
            { storyId: story.id, viewport: viewport.name, err: error },
            "render failed for story",
          );
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

async function captureScreenshot(
  ctx: ScreenshotContext & { executePlay?: boolean; playTimeoutMs?: number },
  story: StoryEntry,
  viewport: Viewport,
): Promise<Buffer> {
  const page = await ctx.browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });
  try {
    await page.goto(ctx.adapter.buildUrl(ctx.baseUrl, story.id), { waitUntil: "networkidle" });
    if (ctx.adapter.screenshotSelector) {
      await page.waitForSelector(ctx.adapter.screenshotSelector, { state: "attached" });
      const delay = story.parameters?.delay ?? 500;
      await page.waitForTimeout(delay);
      if (story.parameters?.pauseAnimationAtEnd) {
        await page.evaluate(() => {
          const doc = globalThis.document as unknown as {
            getAnimations: () => { pause: () => void }[];
          };
          for (const anim of doc.getAnimations()) anim.pause();
        });
      }
    }
    if (ctx.executePlay) {
      const timeout = ctx.playTimeoutMs ?? 10_000;
      try {
        await page.evaluate(
          async ({ storyId, timeoutMs }: { storyId: string; timeoutMs: number }) => {
            const win = globalThis as unknown as {
              __STORYBOOK_PREVIEW__?: {
                executePlay?: (id: string) => Promise<void>;
                storyStore?: { fromId?: (id: string) => { play?: () => Promise<void> } };
                channel?: { on: (e: string, cb: (err: unknown) => void) => void };
              };
            };
            const preview = win["__STORYBOOK_PREVIEW__"];
            if (!preview) return;
            // Try channel-based error capture for play failures
            let playError: unknown = null;
            const handler = (err: unknown): void => {
              playError = err;
            };
            // Storybook channel emits playFunctionThrewException on failure
            try {
              preview.channel?.on("playFunctionThrewException", handler);
            } catch {
              // Channel hookup is best-effort; play still runs without it.
            }
            // Try direct executePlay if available (custom StoryShelf preview addition)
            if (preview.executePlay) {
              await Promise.race([
                preview.executePlay(storyId),
                new Promise((_, reject) => {
                  setTimeout(() => {
                    reject(new Error(`play timeout after ${timeoutMs}ms`));
                  }, timeoutMs);
                }),
              ]);
            } else if (preview.storyStore?.fromId) {
              const loaded = preview.storyStore.fromId(storyId) as unknown as {
                play?: (ctx: unknown) => Promise<void>;
              };
              if (loaded?.play) {
                await Promise.race([
                  loaded.play({
                    canvasElement: globalThis.document.querySelector("#storybook-root"),
                  }),
                  new Promise((_, reject) => {
                    setTimeout(() => {
                      reject(new Error(`play timeout after ${timeoutMs}ms`));
                    }, timeoutMs);
                  }),
                ]);
              }
            }
            if (playError) throw playError;
          },
          { storyId: story.id, timeoutMs: timeout },
        );
      } catch (error) {
        throw new Error(`play failed: ${messageOf(error)}`, { cause: error });
      }
    }
    // Playwright page.screenshot supports animations: disabled to freeze CSS animations
    return await page.screenshot({
      animations: story.parameters?.pauseAnimationAtEnd ? "allow" : "disabled",
    });
  } finally {
    await page.close();
  }
}
