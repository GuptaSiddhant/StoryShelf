import { describe, expect, it } from "vitest";
import { a11yCarrierOf, a11yViolationsOf } from "./a11y-violations.tsx";

const WITH = {
  a11yViolations: JSON.stringify(["color-contrast (serious): x"]),
  browser: "chromium",
};
const WITHOUT = { a11yViolations: null, browser: "firefox" };

describe("a11yViolationsOf", () => {
  it("reads the stored list and tolerates unreadable data", () => {
    expect(a11yViolationsOf(WITH)).toEqual(["color-contrast (serious): x"]);
    expect(a11yViolationsOf(WITHOUT)).toEqual([]);
    expect(a11yViolationsOf({ a11yViolations: "{" })).toEqual([]);
  });
});

describe("a11yCarrierOf", () => {
  it("finds the sibling that carries the findings (axe runs on the primary target only)", () => {
    expect(a11yCarrierOf(WITHOUT, [WITHOUT, WITH])).toBe(WITH);
    expect(a11yCarrierOf(WITH, [WITH, WITHOUT])).toBe(WITH);
    expect(a11yCarrierOf(WITHOUT, [WITHOUT])).toBe(WITHOUT);
  });
});
