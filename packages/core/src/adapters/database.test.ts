import { describe, expect, it } from "vitest";
import { clampListLimit, MAX_LIST_LIMIT } from "./database.ts";

describe("clampListLimit", () => {
  it("passes missing limits through", () => {
    expect(clampListLimit()).toBeUndefined();
  });

  it("clamps into range", () => {
    expect(clampListLimit(0)).toBe(1);
    expect(clampListLimit(10)).toBe(10);
    expect(clampListLimit(MAX_LIST_LIMIT + 500)).toBe(MAX_LIST_LIMIT);
    expect(clampListLimit(Number.NaN)).toBe(MAX_LIST_LIMIT);
  });
});
