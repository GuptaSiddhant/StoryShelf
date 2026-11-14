import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestTracker } from "./network-quiet.ts";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { inPageWaitSettled, type SettleReport } from "./settle.ts";
import { captureSwitched, prepareSwitch } from "./switch-capture.ts";
import { inPageSwitch, inPageTidy } from "./switch-page.ts";
import type { CaptureContext } from "./types.ts";

const finish = vi.hoisted(() => vi.fn());
vi.mock("./screenshot.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshot.ts")>()),
  finishCapture: finish,
}));

const viewport = { name: "desktop", width: 800, height: 600 };
const settled: SettleReport = { settled: true, hooked: true, phase: "completed", elapsedMs: 5 };

function fakePage(answers: { report?: SettleReport; switched?: boolean; drift?: string | null }) {
  const page = {
    viewportSize: vi.fn(() => ({ width: 800, height: 900 })),
    setViewportSize: vi.fn(async () => {}),
    mouse: { move: vi.fn(async () => {}) },
    context: () => ({ clearCookies: page.clearCookies }),
    clearCookies: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    evaluate: vi.fn(async (fn: unknown) => {
      if (fn === inPageTidy) return answers.drift ?? null;
      if (fn === inPageSwitch) return answers.switched ?? true;
      return fn === inPageWaitSettled ? (answers.report ?? settled) : null;
    }),
  };
  return page;
}

const ctx = {
  adapter: new StorybookAdapter(),
  runtimeParams: createRuntimeParamsState(),
} as unknown as CaptureContext;

const story = (parameters: StoryEntry["parameters"] = {}): StoryEntry => ({
  id: "a--b",
  title: "A",
  name: "B",
  type: "story",
  parameters,
});

const quiet = (value: boolean): RequestTracker => ({
  quiet: vi.fn(async () => value),
  dispose: vi.fn(),
});

beforeEach(() => {
  finish.mockReset().mockResolvedValue({
    screenshot: Buffer.from([1]),
    a11yViolations: [],
    story: story(),
  });
});

describe("prepareSwitch", () => {
  it("restores the viewport, the pointer, storage and cookies, then tidies the document", async () => {
    const page = fakePage({ drift: "head" });
    expect(await prepareSwitch(page as never, viewport)).toBe("head");
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 800, height: 600 });
    expect(page.mouse.move).toHaveBeenCalledWith(0, 0);
    expect(page.clearCookies).toHaveBeenCalled();
  });

  it("leaves a viewport of the right size alone", async () => {
    const page = fakePage({});
    page.viewportSize.mockReturnValue({ width: 800, height: 600 });
    expect(await prepareSwitch(page as never, viewport)).toBeNull();
    expect(page.setViewportSize).not.toHaveBeenCalled();
  });
});

describe("captureSwitched", () => {
  it("captures a story that settles on its own events and goes quiet", async () => {
    const page = fakePage({});
    const outcome = await captureSwitched(
      page as never,
      ctx,
      story({ delay: 20 }),
      viewport,
      quiet(true),
    );
    expect(outcome).toMatchObject({ screenshot: Buffer.from([1]) });
    expect(page.evaluate).toHaveBeenCalledWith(inPageSwitch, "a--b");
    expect(page.waitForTimeout).toHaveBeenCalledWith(20);
    expect(finish).toHaveBeenCalledWith(
      ctx,
      page,
      expect.objectContaining({ id: "a--b" }),
      viewport,
      settled,
    );
  });

  it("does not switch to a story that asks for isolation or paused animations", async () => {
    const page = fakePage({});
    expect(
      await captureSwitched(page as never, ctx, story({ isolate: true }), viewport, quiet(true)),
    ).toBe("isolate");
    expect(
      await captureSwitched(
        page as never,
        ctx,
        story({ pauseAnimationAtEnd: true }),
        viewport,
        quiet(true),
      ),
    ).toBe("paused");
    expect(page.evaluate).not.toHaveBeenCalledWith(inPageSwitch, "a--b");
  });

  it("gives back anything uncertain for a fresh page: no channel, no signal, an error, no quiet", async () => {
    const run = async (page: ReturnType<typeof fakePage>, tracker = quiet(true)) =>
      await captureSwitched(page as never, ctx, story(), viewport, tracker);
    expect(await run(fakePage({ switched: false }))).toBe("failed");
    expect(await run(fakePage({ report: { ...settled, settled: false } }))).toBe("failed");
    expect(await run(fakePage({ report: { ...settled, renderError: "boom" } }))).toBe("failed");
    expect(await run(fakePage({}), quiet(false))).toBe("quiet");
    expect(finish).not.toHaveBeenCalled();
  });
});
