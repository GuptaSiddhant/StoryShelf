import { describe, expect, it } from "vitest";
import { inStep, stepOf } from "./render-step.ts";

describe("inStep", () => {
  it("tags the thrown error with the innermost step and rethrows it untouched", async () => {
    const error = new Error("boom");
    await expect(
      inStep("navigate", async () => await inStep("screenshot", () => Promise.reject(error))),
    ).rejects.toBe(error);
    expect(stepOf(error)).toBe("screenshot");
  });

  it("finds the step through a wrapper's cause, and returns the result when nothing throws", async () => {
    const inner = new Error("inner");
    await inStep("ready", () => Promise.reject(inner)).catch(() => {});
    expect(stepOf(new Error("wrapper", { cause: inner }))).toBe("ready");
    await expect(inStep("play", () => Promise.resolve(7))).resolves.toBe(7);
    expect(stepOf("text")).toBeUndefined();
    expect(stepOf(new Error("untagged"))).toBeUndefined();
  });
});
