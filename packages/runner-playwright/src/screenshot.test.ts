import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { describe, expect, it, vi } from "vitest";
import { TransientCaptureError } from "./capture-retry.ts";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { captureScreenshot } from "./screenshot.ts";
import { inPagePaint, inPageWaitSettled, type SettleReport } from "./settle.ts";
import type { CaptureContext } from "./types.ts";

const viewport = { name: "desktop", width: 800, height: 600 };

/** A page that answers the settle wait with `report` and records every fixed wait. */
function harness(report: SettleReport | null, overrides: Partial<CaptureContext> = {}) {
  const waits: number[] = [];
  const evaluated: unknown[] = [];
  const page = {
    goto: async (): Promise<void> => {},
    setDefaultTimeout: (): void => {},
    addInitScript: async (): Promise<void> => {},
    setViewportSize: async (): Promise<void> => {},
    waitForSelector: async (): Promise<null> => null,
    waitForTimeout: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
    evaluate: async (fn: unknown): Promise<unknown> => {
      evaluated.push(fn);
      return fn === inPageWaitSettled ? report : undefined;
    },
    locator: () => ({ boundingBox: async (): Promise<null> => null }),
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
  return { ctx, page, waits, evaluated, logger };
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
  it("classifies a navigation timeout and discards its page", async () => {
    const { ctx, page } = harness(settled);
    const close = vi.spyOn(page, "close");
    page.goto = async () => {
      throw Object.assign(new Error("navigation timeout"), { name: "TimeoutError" });
    };
    await expect(captureScreenshot(ctx, story(), viewport)).rejects.toMatchObject({
      phase: "navigation",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("classifies a page crash and discards the page", async () => {
    const { ctx, page } = harness(settled);
    let crash: (() => void) | undefined;
    Object.assign(page, {
      on: (_event: string, listener: () => void) => {
        crash = listener;
      },
      off: () => {},
    });
    page.goto = async () => {
      crash?.();
      throw new Error("page crashed");
    };
    await expect(captureScreenshot(ctx, story(), viewport)).rejects.toBeInstanceOf(
      TransientCaptureError,
    );
  });

  it("bypasses the reusable page pool when a fresh retry is requested", async () => {
    const { ctx } = harness(settled);
    const pool = { acquire: vi.fn() };
    ctx.pagePool = pool as never;
    await captureScreenshot(ctx, story(), viewport, true);
    expect(pool.acquire).not.toHaveBeenCalled();
  });

  it("does not sleep when Storybook says it finished and no delay is set", async () => {
    const { ctx, waits, evaluated } = harness(settled);
    await captureScreenshot(ctx, story(), viewport);
    expect(waits).toEqual([]);
    expect(evaluated).toContain(inPagePaint);
  });

  it("still honours an explicit delay after the signal", async () => {
    const { ctx, waits } = harness(settled);
    await captureScreenshot(ctx, story(120), viewport);
    expect(waits).toEqual([120]);
  });

  it("honours an explicit delay of zero without the fixed wait", async () => {
    const { ctx, waits } = harness(settled);
    await captureScreenshot(ctx, story(0), viewport);
    expect(waits).toEqual([0]);
  });

  it("falls back to the fixed 500 ms wait when the page never signals", async () => {
    const { ctx, waits, logger } = harness({
      settled: false,
      hooked: true,
      phase: "rendering",
      elapsedMs: 5000,
    });
    await captureScreenshot(ctx, story(), viewport);
    expect(waits).toEqual([500]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storyId: "a--b", phase: "rendering" }),
      expect.stringContaining("did not signal"),
    );
  });

  it("falls back to the story's delay on a page without a channel, without a log line", async () => {
    const { ctx, waits, logger } = harness({
      settled: false,
      hooked: false,
      phase: null,
      elapsedMs: 0,
    });
    await captureScreenshot(ctx, story(75), viewport);
    expect(waits).toEqual([75]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back when the page cannot answer at all", async () => {
    const { ctx, waits } = harness(null);
    await captureScreenshot(ctx, story(), viewport);
    expect(waits).toEqual([500]);
  });

  it("logs what Storybook said when the story errored, and still photographs it", async () => {
    const { ctx, logger } = harness({ ...settled, phase: "errored", renderError: "Cannot read x" });
    const result = await captureScreenshot(ctx, story(), viewport);
    expect(result.screenshot).toEqual(Buffer.from([1]));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ problem: "Cannot read x", phase: "errored" }),
      "story reported an error while rendering",
    );
  });

  it("passes the context's timeout to the wait", async () => {
    const { ctx, evaluated } = harness(settled, { settleTimeoutMs: 1234 });
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
    expect(evaluated).toContain(inPageWaitSettled);
  });
});
