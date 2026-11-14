import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inPagePlay } from "./play.ts";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { captureScreenshot, sessionEndOf } from "./screenshot.ts";
import { createBrowserSession } from "./session.ts";
import { inPagePaint, inPageWaitSettled, type SettleReport } from "./settle.ts";
import type { CaptureContext } from "./types.ts";

const viewport = { name: "desktop", width: 800, height: 600 };

/** Record the fixed waits the pipeline asks for, running each callback on the next tick. */
function recordWaits(): number[] {
  const waits: number[] = [];
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    waits.push(timeout ?? 0);
    return real(callback, 0, ...args);
  }) as typeof setTimeout);
  return waits;
}

afterEach(() => vi.restoreAllMocks());

/** A page that answers the settle wait with `report` and records every fixed wait. */
function harness(report: SettleReport | null, overrides: Partial<CaptureContext> = {}) {
  const evaluated: unknown[] = [];
  const styles: string[] = [];
  const page = {
    goto: async (): Promise<void> => {},
    setDefaultTimeout: (): void => {},
    evaluateOnNewDocument: async (): Promise<void> => {},
    setViewport: async (): Promise<void> => {},
    waitForSelector: async (): Promise<null> => null,
    addStyleTag: async ({ content }: { content: string }): Promise<void> => {
      styles.push(content);
    },
    evaluate: async (fn: unknown, arg?: unknown): Promise<unknown> => {
      evaluated.push(fn);
      // The ignore-selector check: "!!bad" stands for a selector the browser rejects.
      if (Array.isArray(arg)) return (arg as string[]).filter((s) => s === "!!bad");
      return fn === inPageWaitSettled ? report : undefined;
    },
    $: async () => ({ boundingBox: async (): Promise<null> => null }),
    screenshot: async (): Promise<Buffer> => Buffer.from([1]),
    close: async (): Promise<void> => {},
  };
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const session = createBrowserSession({
    browser: { newPage: async () => page } as never,
    ownership: "launched",
  });
  const ctx = {
    session,
    pagePool: undefined,
    adapter: new StorybookAdapter(),
    baseUrl: "http://sb",
    runtimeParams: createRuntimeParamsState(),
    logger,
    ...overrides,
  } as unknown as CaptureContext;
  return { ctx, page, evaluated, styles, logger };
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
    expect(await captureScreenshot(ctx, story(), viewport)).toMatchObject({
      screenshot: Buffer.from([1]),
    });
    expect(evaluated).toContain(inPagePaint);
  });

  it("waits the configured delay before the play function runs", async () => {
    const order: string[] = [];
    const { promise: delayDone, resolve: finishDelay } = Promise.withResolvers<null>();
    const real = globalThis.setTimeout;
    // Only the story's 300 ms delay is held; every other timer runs as usual.
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout !== 300) return real(callback, timeout, ...args);
      order.push("delay 300");
      delayDone.then(() => (callback as (...rest: unknown[]) => void)(...args)).catch(() => {});
      return 0;
    }) as typeof setTimeout);
    const { ctx, page } = harness(settled, { executePlay: true });
    const evaluate = page.evaluate;
    page.evaluate = async (fn: unknown, arg?: unknown): Promise<unknown> => {
      if (fn === inPagePlay) order.push("play");
      return await evaluate(fn, arg);
    };
    const capturing = captureScreenshot(ctx, story(300), viewport);
    await vi.waitFor(() => {
      expect(order).toEqual(["delay 300"]);
    });
    // The delay is held open: once every pending microtask has run, play has still not started.
    await new Promise((resolve) => real(resolve, 0));
    expect(order).toEqual(["delay 300"]);
    finishDelay(null);
    await capturing;
    expect(order).toEqual(["delay 300", "play"]);
  });

  it("still honours an explicit delay after the signal", async () => {
    const waits = recordWaits();
    const { ctx } = harness(settled);
    expect(await captureScreenshot(ctx, story(300), viewport)).toMatchObject({
      screenshot: Buffer.from([1]),
    });
    expect(waits).toEqual([300]);
  });

  it("falls back to the fixed 500 ms wait when the page never signals", async () => {
    const waits = recordWaits();
    const { ctx, logger } = harness({
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
    const waits = recordWaits();
    const { ctx, logger } = harness({
      settled: false,
      hooked: false,
      phase: null,
      elapsedMs: 0,
    });
    await captureScreenshot(ctx, story(150), viewport);
    expect(waits).toEqual([150]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back when the page cannot answer at all", async () => {
    const waits = recordWaits();
    const { ctx } = harness(null);
    await captureScreenshot(ctx, story(), viewport);
    expect(waits).toEqual([500]);
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
      ctx.session.browser as unknown as {
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

const withIgnore = (selectors: string[]): StoryEntry =>
  ({ ...story(), parameters: { ignoreSelectors: selectors } }) as StoryEntry;

describe("ignore regions", () => {
  it("injects one mask stylesheet before the screenshot, defaults included", async () => {
    const { ctx, styles } = harness(settled);
    await captureScreenshot(ctx, withIgnore([".clock"]), viewport);
    expect(styles).toHaveLength(1);
    // Marked, so a switch can remove it before the next story (ADR 0052).
    expect(styles[0]?.startsWith("/* storyshelf-mask */")).toBe(true);
    expect(styles[0]).toContain(".clock { visibility: hidden !important; opacity: 0 !important; }");
    expect(styles[0]).toContain("[data-storyshelf-ignore]");
  });

  it("skips a selector the browser rejects, with a warning, and still captures", async () => {
    const { ctx, styles, logger } = harness(settled);
    const result = await captureScreenshot(ctx, withIgnore([".ok", "!!bad"]), viewport);
    expect(result.screenshot).toEqual(Buffer.from([1]));
    expect(styles[0]).toContain(".ok {");
    expect(styles[0]).not.toContain("!!bad");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storyId: "a--b", selectors: ["!!bad"] }),
      expect.stringContaining("invalid ignore selectors"),
    );
  });

  it("reports a selector refused as unsafe, and keeps it out of the stylesheet", async () => {
    const { ctx, styles, logger } = harness(settled);
    await captureScreenshot(ctx, withIgnore([".ok", "a{}"]), viewport);
    expect(styles[0]).toContain(".ok {");
    expect(styles[0]).not.toContain("a{}");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storyId: "a--b", selectors: ["a{}"] }),
      expect.stringContaining("invalid ignore selectors"),
    );
  });

  it("never fails the capture when the stylesheet cannot be injected", async () => {
    const { ctx, page, logger } = harness(settled);
    page.addStyleTag = async () => {
      throw new Error("csp");
    };
    await expect(captureScreenshot(ctx, story(), viewport)).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storyId: "a--b" }),
      expect.stringContaining("could not mask"),
    );
  });
});

describe("sessionEndOf (ADR 0052, decision 4)", () => {
  const plain = story();

  it("lets a page that settled cleanly be switched from", () => {
    expect(sessionEndOf(plain, settled, 0)).toBeUndefined();
  });

  it("ends the session after a failure, a fixed wait or no report at all", () => {
    expect(sessionEndOf(plain, { ...settled, renderError: "boom" }, 0)).toBe("failed");
    expect(sessionEndOf(plain, { ...settled, unhandled: ["late"] }, 0)).toBe("failed");
    expect(sessionEndOf(plain, { ...settled, settled: false }, 0)).toBe("failed");
    expect(sessionEndOf(plain, undefined, 0)).toBe("failed");
  });

  it("ends the session after a play function, `isolate`, or anything the runner paused", () => {
    expect(sessionEndOf({ ...plain, tags: ["play-fn"] }, settled, 0)).toBe("play");
    expect(sessionEndOf({ ...plain, parameters: { isolate: true } }, settled, 0)).toBe("isolate");
    expect(sessionEndOf({ ...plain, parameters: { pauseAnimationAtEnd: true } }, settled, 0)).toBe(
      "paused",
    );
    expect(sessionEndOf(plain, settled, 2)).toBe("paused");
  });
});
