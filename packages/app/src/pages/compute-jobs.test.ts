import { describe, expect, it } from "vitest";
import { isStuckCapture } from "./compute-jobs.tsx";

describe("isStuckCapture", () => {
  it("flags a capturing build the in-process queue no longer tracks", () => {
    expect(isStuckCapture("capturing", false, true)).toBe(true);
  });

  it("does not flag a build the queue is still running", () => {
    expect(isStuckCapture("capturing", true, true)).toBe(false);
  });

  it("never flags builds on remote queues, which the server cannot see", () => {
    expect(isStuckCapture("capturing", false, false)).toBe(false);
  });

  it("only applies to the capturing status", () => {
    expect(isStuckCapture("pending", false, true)).toBe(false);
    expect(isStuckCapture("failed", false, true)).toBe(false);
  });
});
