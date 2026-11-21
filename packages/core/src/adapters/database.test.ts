import { describe, expect, it } from "vitest";
import { clampListLimit, listPage, MAX_LIST_LIMIT } from "./database.ts";

describe("listPage", () => {
  it("applies nothing when neither is given", () => {
    expect(listPage({})).toEqual({});
  });

  it("applies a limit of zero or more, and drops a negative or NaN one", () => {
    expect(listPage({ limit: 0 })).toEqual({ limit: 0 });
    expect(listPage({ limit: 25 })).toEqual({ limit: 25 });
    expect(listPage({ limit: -1 })).toEqual({});
    expect(listPage({ limit: Number.NaN })).toEqual({});
  });

  it("applies a non-zero offset, and drops zero or NaN", () => {
    expect(listPage({ offset: 10 })).toEqual({ offset: 10 });
    expect(listPage({ offset: 0 })).toEqual({});
    expect(listPage({ offset: Number.NaN })).toEqual({});
    expect(listPage({ limit: 5, offset: 5 })).toEqual({ limit: 5, offset: 5 });
  });
});

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
