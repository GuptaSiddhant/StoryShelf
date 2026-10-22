import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { captureScreenshot } from "./screenshot.ts";
import { inPagePaint, inPageWaitSettled, type SettleReport } from "./settle.ts";
import type { CaptureContext } from "./types.ts";

const viewport = { name: "desktop", width: 800, height: 600 };

async function timed(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

/** A page that answers the settle wait with `report` and records every fixed wait. */
function harness(report: SettleReport | null, overrides: Partial<CaptureContext> = {}) {
  const evaluated: unknown[] = [];
  const page = {
    goto: async (): Promise<void> => {},
    setDefaultTimeout: (): void => {},
    evaluateOnNewDocument: async (): Promise<void> => {},
    setViewport: async (): Promise<void> => {},
    waitForSelector: async (): Promise<null> => null,
    evaluate: async (fn: unknown): Promise<unknown> => {
      evaluated.push(fn);
      return fn === inPageWaitSettled ? report : undefined;
    },
    $: async () => ({ boundingBox: async (): Promise<null> => null }),
    screenshot: async (): Promise<Buffer> => Buffer.from([1]),
    close: async (): Promise<void> => {},
  };
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const ctx = {
    browser: { newPage: async () => page },
    adapter: new StorybookAdapter(),
    baseUrl: "http://sb",
    runtimeParams: createRuntimeParamsState(),
    logger,
    ...overrides,
  } as unknown as CaptureContext;
  return { ctx, page, evaluated, logger };
}

function story(delay?: number): StoryEntry {
  return {
    id: "a--b",
    title: "A",
    name: "B",
    importPath: "./a.stories.ts",
    parameters: delay === undefined ? {} : { delay },
  } as StoryEntry;
}

const settled: SettleReport = { settled: true, hooked: true, phase: "completed", elapsedMs: 40 };

describe("waiting for the story to be ready", () => {
  it("does not sleep when Storybook says it finished and no delay is set", async () => {
    const { ctx, evaluated } = harness(settled);
    expect(await timed(async () => await captureScreenshot(ctx, story(), viewport))).toBeLessThan(
      300,
    );
    expect(evaluated).toContain(inPagePaint);
  });

  it("still honours an explicit delay after the signal", async () => {
    const { ctx } = harness(settled);
    expect(
      await timed(async () => await captureScreenshot(ctx, story(300), viewport)),
    ).toBeGreaterThanOrEqual(290);
  });

  it("falls back to the fixed 500 ms wait when the page never signals", async () => {
    const { ctx, logger } = harness({
      settled: false,
      hooked: true,
      phase: "rendering",
      elapsedMs: 5000,
    });
    expect(
      await timed(async () => await captureScreenshot(ctx, story(), viewport)),
    ).toBeGreaterThanOrEqual(490);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storyId: "a--b", phase: "rendering" }),
      expect.stringContaining("did not signal"),
    );
  });

  it("falls back to the story's delay on a page without a channel, without a log line", async () => {
    const { ctx, logger } = harness({
      settled: false,
      hooked: false,
      phase: null,
      elapsedMs: 0,
    });
    const took = await timed(async () => await captureScreenshot(ctx, story(150), viewport));
    expect(took).toBeGreaterThanOrEqual(140);
    expect(took).toBeLessThan(450);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back when the page cannot answer at all", async () => {
    const { ctx } = harness(null);
    expect(
      await timed(async () => await captureScreenshot(ctx, story(), viewport)),
    ).toBeGreaterThanOrEqual(490);
  });

  it("logs what Storybook said when the story errored, and still photographs it", async () => {
    const { ctx, logger } = harness({ ...settled, phase: "errored", renderError: "Cannot read x" });
    const result = await captureScreenshot(ctx, story(), viewport);
    expect(result.screenshot).toBeInstanceOf(Buffer);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ problem: "Cannot read x", phase: "errored" }),
      "story reported an error while rendering",
    );
  });

  it("passes the context's timeout to the wait", async () => {
    const { ctx } = harness(settled, { settleTimeoutMs: 1234 });
    const seen: unknown[] = [];
    const page = await (
      ctx.browser as unknown as {
        newPage: () => Promise<{ evaluate: (fn: unknown, arg?: unknown) => Promise<unknown> }>;
      }
    ).newPage();
    const original = page.evaluate;
    page.evaluate = async (fn, arg) => {
      if (fn === inPageWaitSettled) seen.push(arg);
      return await original(fn, arg);
    };
    await captureScreenshot(ctx, story(), viewport);
    expect(seen).toEqual([{ timeoutMs: 1234 }]);
  });
});
