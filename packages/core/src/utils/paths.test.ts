import { describe, expect, it } from "vitest";
import { baselinePath, screenshotPath } from "./paths.ts";

describe("storage path builders", () => {
  it("builds screenshot paths", () => {
    expect(screenshotPath("p1", "b1", "story", "desktop")).toBe(
      "p1/builds/b1/screenshots/story/desktop.png",
    );
  });

  it("rejects traversal segments", () => {
    expect(() => screenshotPath("p1", "b1", "../../x", "desktop")).toThrow("Unsafe");
    expect(() => screenshotPath("p1", "b1", "..", "desktop")).toThrow("Unsafe");
    expect(() => baselinePath("", "main", "a", "desktop")).toThrow("Unsafe");
  });

  it("allows slashes inside branch names", () => {
    expect(baselinePath("p1", "feature/foo", "a", "desktop")).toBe(
      "p1/baselines/feature/foo/a/desktop.png",
    );
  });
});
