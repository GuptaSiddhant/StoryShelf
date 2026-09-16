import type {
  BrowserName,
  CaptureRunner,
  RenderResult,
  RenderedSnapshot,
  StoryEntry,
  StorySourceAdapter,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { getScreenshotPlan } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import { chromium, firefox, webkit, type Browser } from "playwright-core";
import { createStaticServer } from "./static-server.ts";

declare const __PKG_VERSION__: string | undefined;

/** Create a CaptureRunner that renders Storybook stories with Playwright. */
export function createPlaywrightCaptureRunner(
  options: {
    browser?: BrowserName;
    supportedBrowsers?: readonly BrowserName[];
  } = {},
): CaptureRunner {
  const defaultBrowser = options.browser ?? "chromium";
  return {
    metadata: {
      name: "Playwright",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Playwright capture runner",
      kind: "playwright",
      category: "capture-runner",
      supportedBrowsers: options.supportedBrowsers ?? ["chromium", "firefox", "webkit", "chrome"],
    },
    async render(input: PlaywrightRenderInput) {
      const active: ActiveRun = { cancelled: false, browser: null };
      activeRuns.set(input.buildId, active);
      try {
        return await renderAll(input, active, defaultBrowser);
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

/** Input for a Playwright capture run over a built Storybook directory. */
export interface PlaywrightRenderInput {
  buildId: string;
  storybookDir: string;
  stories: StoryEntry[];
  viewports: Viewport[];
  logger?: Logger;
  executePlay?: boolean;
  playTimeoutMs?: number;
  runA11y?: boolean;
  browser?: BrowserName;
}

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

async function renderAll(
  input: PlaywrightRenderInput,
  active: ActiveRun,
  defaultBrowser: BrowserName,
): Promise<RenderResult> {
  const server = await createStaticServer(input.storybookDir);
  const launchBrowser = async (): Promise<Browser> => {
    const name = input.browser ?? defaultBrowser;
    if (name === "firefox") return await firefox.launch();
    if (name === "webkit") return await webkit.launch();
    return await chromium.launch();
  };
  const browser = await launchBrowser();
  active.browser = browser;
  const adapter = new StorybookAdapter();
  const ctx: ScreenshotContext & {
    executePlay?: boolean;
    playTimeoutMs?: number;
    runA11y?: boolean;
  } = {
    browser,
    adapter,
    baseUrl: server.url,
    executePlay: input.executePlay,
    playTimeoutMs: input.playTimeoutMs,
    runA11y: input.runA11y,
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
          const { screenshot, a11yViolations } = await captureScreenshot(ctx, story, viewport);
          captures.push({ story, viewportName: viewport.name, screenshot });
          if (a11yViolations.length > 0) {
            failures.push({
              storyId: story.id,
              viewportName: viewport.name,
              error: `a11y: ${a11yViolations.join("; ")}`,
            });
            input.logger?.warn(
              { storyId: story.id, viewport: viewport.name, violations: a11yViolations },
              "a11y violations found",
            );
          }
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
  ctx: ScreenshotContext & { executePlay?: boolean; playTimeoutMs?: number; runA11y?: boolean },
  story: StoryEntry,
  viewport: Viewport,
): Promise<{ screenshot: Buffer; a11yViolations: string[] }> {
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
            // oxlint-disable-next-line typescript/dot-notation -- __STORYBOOK_PREVIEW__ is a Storybook global
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
    let a11yViolations: string[] = [];
    if (ctx.runA11y) {
      try {
        a11yViolations = await checkA11y(page);
      } catch {
        // a11y check failures are non-blocking; ignore and continue to screenshot
      }
    }
    // SteadySnap lite: wait for fonts and freeze videos
    const burst = (story.parameters as { burst?: number } | undefined)?.burst ?? 1;
    const waitForFonts =
      (story.parameters as { waitForFonts?: boolean } | undefined)?.waitForFonts ?? burst > 1;
    if (waitForFonts) {
      try {
        // oxlint-disable-next-line promise-function-async -- fonts.ready returns a Promise
        await page.evaluate(async () => {
          await (globalThis as unknown as { document: { fonts: { ready: Promise<void> } } })
            .document.fonts.ready;
        });
      } catch {
        // fonts.ready is best-effort
      }
    }
    try {
      await page.evaluate(() => {
        for (const v of (globalThis as unknown as { document: Document }).document.querySelectorAll(
          "video",
        ))
          (v as HTMLVideoElement).pause();
      });
    } catch {
      // video pause is best-effort
    }
    // Diff screenshots only: auto-crop small components (60% whitespace) with 16px padding and min/max clamp, fullPage on overflow
    const box = await page
      .locator("#storybook-root")
      .boundingBox()
      .catch(() => null);
    const plan = getScreenshotPlan(viewport, box, {
      autoCrop: story.parameters?.autoCrop,
      whitespaceThreshold: story.parameters?.autoCropThreshold,
      fullPageOnOverflow: story.parameters?.fullPageOnOverflow,
      minWidth: story.parameters?.minWidth,
      minHeight: story.parameters?.minHeight,
      maxWidth: story.parameters?.maxWidth,
      maxHeight: story.parameters?.maxHeight,
    });
    if (plan.viewport.width !== viewport.width || plan.viewport.height !== viewport.height) {
      await page.setViewportSize(plan.viewport);
    }
    const burstCount = Math.max(1, Math.min(5, burst));
    const shots: Buffer[] = [];
    for (let index = 0; index < burstCount; index += 1) {
      if (index > 0) await page.waitForTimeout(100);
      const shot = await page.screenshot({
        animations: story.parameters?.pauseAnimationAtEnd ? "allow" : "disabled",
        ...(plan.fullPage ? { fullPage: true } : {}),
        ...(plan.clip ? { clip: plan.clip } : {}),
      });
      shots.push(shot as Buffer);
    }
    // Burst stability vote: pick the middle burst (most stable heuristic without pixel diff)
    const screenshot =
      shots[Math.floor(shots.length / 2)] ??
      shots[0] ??
      ((await page.screenshot({ animations: "disabled" })) as Buffer);
    return { screenshot, a11yViolations };
  } finally {
    await page.close();
  }
}

async function checkA11y(page: import("playwright-core").Page): Promise<string[]> {
  return await page.evaluate(() => {
    const doc = globalThis.document as unknown as Document;
    const violations: string[] = [];
    const root = doc.querySelector("#storybook-root");
    if (!root) return violations;
    // Images without alt
    for (const img of root.querySelectorAll("img:not([alt])")) {
      const html = (img as HTMLElement).outerHTML.slice(0, 120);
      violations.push(`img missing alt: ${html}`);
    }
    // Buttons without accessible name
    for (const btn of root.querySelectorAll("button")) {
      const hasLabel =
        btn.hasAttribute("aria-label") ||
        btn.hasAttribute("aria-labelledby") ||
        (btn.textContent ?? "").trim() !== "";
      if (!hasLabel)
        violations.push(`button missing label: ${(btn as HTMLElement).outerHTML.slice(0, 120)}`);
    }
    // Links without href or text
    for (const a of root.querySelectorAll("a")) {
      if (!a.hasAttribute("href"))
        violations.push(`a missing href: ${(a as HTMLElement).outerHTML.slice(0, 120)}`);
    }
    // Form inputs without label
    for (const input of root.querySelectorAll("input, select, textarea")) {
      const el = input as HTMLInputElement;
      const hasLabel =
        el.hasAttribute("aria-label") ||
        el.hasAttribute("aria-labelledby") ||
        Boolean(doc.querySelector(`label[for="${el.id}"]`)) ||
        el.id === "";
      if (!hasLabel && el.type !== "hidden")
        violations.push(`input missing label: ${el.outerHTML.slice(0, 120)}`);
    }
    return violations.slice(0, 10);
  });
}
