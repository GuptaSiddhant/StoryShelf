import { describe, expect, it, vi } from "vitest";
import { capturePhase, TransientCaptureError } from "./capture-retry.ts";
import { screenshotWithRetry } from "./pipeline.ts";
import { captureScreenshot } from "./screenshot.ts";

vi.mock("./screenshot.ts", () => ({ captureScreenshot: vi.fn() }));

const story = { id: "button--primary", title: "Button", name: "Primary", type: "story" } as const;
const viewport = { name: "desktop", width: 800, height: 600 };
const result = { story, screenshot: Buffer.from("image"), a11yViolations: [] };
const screenshot = vi.mocked(captureScreenshot);

function setup(connected = true) {
  screenshot.mockReset();
  const ctx = { browser: { isConnected: () => connected } } as never;
  const active = { cancelled: false, browser: null, abort: new AbortController() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const input = {
    buildId: "b",
    storybookDir: "",
    stories: [story],
    viewports: [viewport],
    retryRemoteCapture: true,
    logger: logger as never,
  };
  return { ctx, active, logger, input };
}

describe("remote screenshot retry", () => {
  it.each(["navigation", "screenshot", "crash"] as const)(
    "retries a %s failure once on a fresh page",
    async (phase) => {
      const { ctx, active, input, logger } = setup();
      screenshot
        .mockRejectedValueOnce(new TransientCaptureError(phase, new Error("temporary")))
        .mockResolvedValueOnce(result);
      await expect(screenshotWithRetry(ctx, story, viewport, input, active)).resolves.toEqual(
        result,
      );
      expect(screenshot).toHaveBeenCalledTimes(2);
      expect(screenshot).toHaveBeenLastCalledWith(ctx, story, viewport, true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ phase, attempt: 2 }),
        expect.any(String),
      );
      expect(logger.info).toHaveBeenCalledOnce();
    },
  );

  it("does not retry arbitrary errors or a disconnected browser", async () => {
    const first = setup();
    screenshot.mockRejectedValueOnce(new Error("assertion failed"));
    await expect(
      screenshotWithRetry(first.ctx, story, viewport, first.input, first.active),
    ).rejects.toThrow("assertion failed");
    expect(screenshot).toHaveBeenCalledOnce();
    const second = setup(false);
    screenshot.mockRejectedValueOnce(
      new TransientCaptureError("crash", new Error("browser closed")),
    );
    await expect(
      screenshotWithRetry(second.ctx, story, viewport, second.input, second.active),
    ).rejects.toThrow("browser closed");
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it("does not retry local or cancelled captures", async () => {
    const { ctx, active, input } = setup();
    input.retryRemoteCapture = false;
    screenshot.mockRejectedValueOnce(new TransientCaptureError("navigation", new Error("timeout")));
    await expect(screenshotWithRetry(ctx, story, viewport, input, active)).rejects.toThrow(
      "timeout",
    );
    expect(screenshot).toHaveBeenCalledOnce();
    screenshot.mockClear();
    input.retryRemoteCapture = true;
    active.cancelled = true;
    screenshot.mockRejectedValueOnce(new TransientCaptureError("navigation", new Error("timeout")));
    await expect(screenshotWithRetry(ctx, story, viewport, input, active)).rejects.toThrow(
      "timeout",
    );
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it("records the second failure and never attempts a third", async () => {
    const { ctx, active, input, logger } = setup();
    screenshot
      .mockRejectedValueOnce(new TransientCaptureError("navigation", new Error("first")))
      .mockRejectedValueOnce(new Error("second"));
    await expect(screenshotWithRetry(ctx, story, viewport, input, active)).rejects.toThrow(
      "second",
    );
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("does not deliver a result if cancelled during the retry", async () => {
    const { ctx, active, input } = setup();
    screenshot
      .mockRejectedValueOnce(new TransientCaptureError("navigation", new Error("timeout")))
      .mockImplementationOnce(async () => {
        active.cancelled = true;
        return result;
      });
    await expect(screenshotWithRetry(ctx, story, viewport, input, active)).rejects.toThrow(
      "Capture cancelled",
    );
    expect(screenshot).toHaveBeenCalledTimes(2);
  });

  it("does not start a retry when the abort signal is already set", async () => {
    const { ctx, active, input } = setup();
    active.abort.abort();
    screenshot.mockRejectedValueOnce(new TransientCaptureError("navigation", new Error("timeout")));
    await expect(screenshotWithRetry(ctx, story, viewport, input, active)).rejects.toThrow(
      "timeout",
    );
    expect(screenshot).toHaveBeenCalledOnce();
  });
});

it("classifies only named Playwright timeouts in an eligible phase", async () => {
  const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
  await expect(
    capturePhase("navigation", async () => {
      throw timeout;
    }),
  ).rejects.toBeInstanceOf(TransientCaptureError);
  const other = new Error("timeout in deterministic assertion");
  await expect(
    capturePhase("screenshot", async () => {
      throw other;
    }),
  ).rejects.toBe(other);
});
