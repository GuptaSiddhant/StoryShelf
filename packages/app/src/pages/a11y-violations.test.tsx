import { describe, expect, it } from "vitest";
import { a11yCarrierOf, a11ySummaryNote, a11ySummaryOf, a11yViolationsOf } from "./a11y-violations.tsx";

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

describe("a11ySummaryOf", () => {
  it("totals the findings and counts the snapshots that carry any", () => {
    const two = { a11yViolations: JSON.stringify(["a", "b"]) };
    expect(a11ySummaryOf([WITH, two, WITHOUT, { a11yViolations: "{" }])).toEqual({
      findings: 3,
      snapshots: 2,
    });
    expect(a11ySummaryOf([])).toEqual({ findings: 0, snapshots: 0 });
  });
});

describe("overflow line", () => {
  it("counts the N violations an `…and N more` line stands for", () => {
    const capped = { a11yViolations: JSON.stringify(["a", "b", "…and 7 more"]) };
    expect(a11ySummaryOf([capped, WITH])).toEqual({ findings: 10, snapshots: 2 });
  });
});

describe("a11ySummaryNote", () => {
  it("never claims none were found when nothing is recorded", () => {
    expect(a11ySummaryNote({ findings: 0, snapshots: 0 })).toBe(
      "No findings recorded. Information only.",
    );
    expect(a11ySummaryNote({ findings: 3, snapshots: 1 })).toContain("On 1 snapshot.");
  });
});
