import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { describe, expect, it, vi } from "vitest";
import { deliverCapture, pushRenderFailure, type Delivery } from "./deliver.ts";

const viewport = { name: "desktop", width: 800, height: 600 };
const story: StoryEntry = { id: "a--b", title: "A", name: "B", type: "story" };
const logger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) as never;

describe("deliverCapture", () => {
  it("streams the snapshot, marked when it was switched to (ADR 0052)", async () => {
    const onCapture = vi.fn(async () => {});
    const out: Delivery = { captures: [], failures: [] };
    const input = { buildId: "b", storybookDir: "/sb", stories: [], viewports: [], onCapture };
    await deliverCapture(input, out, viewport, {
      screenshot: Buffer.from([1]),
      a11yViolations: [],
      story,
      startedAt: performance.now(),
      switched: true,
    });
    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        viewportName: "desktop",
        switched: true,
        durationMs: expect.any(Number),
      }),
    );
    expect(out.captures).toEqual([]);
  });

  it("keeps the snapshot without a hand-off and reports its accessibility lines", async () => {
    const out: Delivery = { captures: [], failures: [] };
    const input = {
      buildId: "b",
      storybookDir: "/sb",
      stories: [],
      viewports: [],
      logger: logger(),
    };
    await deliverCapture(input, out, viewport, {
      screenshot: Buffer.from([1]),
      a11yViolations: ["color-contrast"],
      story,
      startedAt: performance.now(),
    });
    expect(out.captures[0]).not.toHaveProperty("switched");
    expect(out.captures[0]?.a11y).toEqual(["color-contrast"]);
    expect(out.failures).toEqual([
      { storyId: "a--b", viewportName: "desktop", error: "a11y: color-contrast" },
    ]);
  });
});

describe("pushRenderFailure", () => {
  it("records the story's failure with the error's message", () => {
    const failures: Delivery["failures"] = [];
    pushRenderFailure(
      failures,
      { buildId: "b", storybookDir: "", stories: [], viewports: [], logger: logger() },
      "a",
      "desktop",
      new Error("boom"),
    );
    expect(failures).toEqual([{ storyId: "a", viewportName: "desktop", error: "boom" }]);
  });
});
