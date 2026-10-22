import { describe, expect, it } from "vitest";
import {
  a11yCarrierOf,
  a11yFindingsOf,
  a11ySummaryNote,
  a11ySummaryOf,
  a11yViolationsOf,
  isAxeUnavailable,
} from "./a11y-violations.tsx";

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
      unavailable: 0,
    });
    expect(a11ySummaryOf([])).toEqual({ findings: 0, snapshots: 0, unavailable: 0 });
  });
});

describe("overflow line", () => {
  it("counts the N violations an `…and N more` line stands for", () => {
    const capped = { a11yViolations: JSON.stringify(["a", "b", "…and 7 more"]) };
    expect(a11ySummaryOf([capped, WITH])).toEqual({ findings: 10, snapshots: 2, unavailable: 0 });
  });
});

describe("a11ySummaryNote", () => {
  it("never claims none were found when nothing is recorded", () => {
    expect(a11ySummaryNote({ findings: 0, snapshots: 0, unavailable: 0 })).toBe(
      "No findings recorded. Information only.",
    );
    expect(a11ySummaryNote({ findings: 3, snapshots: 1, unavailable: 0 })).toContain(
      "On 1 snapshot.",
    );
  });
});

describe("axe unavailable markers", () => {
  const DOWN = {
    a11yViolations: JSON.stringify(["axe unavailable: Execution context was destroyed"]),
    browser: "chromium",
  };
  const MIXED = {
    a11yViolations: JSON.stringify(["axe unavailable: boom", "color-contrast (serious): x"]),
    browser: "chromium",
  };

  it("is told apart from a finding by one helper", () => {
    expect(isAxeUnavailable("axe unavailable: boom")).toBe(true);
    expect(isAxeUnavailable("color-contrast (serious): x")).toBe(false);
    expect(a11yFindingsOf(DOWN)).toEqual([]);
    expect(a11yViolationsOf(DOWN)).toHaveLength(1);
  });

  it("never counts toward the build total; it is reported on its own", () => {
    expect(a11ySummaryOf([DOWN, WITH, MIXED])).toEqual({
      findings: 2,
      snapshots: 2,
      unavailable: 2,
    });
    const note = a11ySummaryNote(a11ySummaryOf([DOWN]));
    expect(note).toContain("No findings recorded.");
    expect(note).toContain("axe did not run on 1 snapshot.");
  });

  it("prefers a sibling with findings over a snapshot whose axe run failed", () => {
    expect(a11yCarrierOf(DOWN, [DOWN, WITH])).toBe(WITH);
    expect(a11yCarrierOf(WITHOUT, [WITHOUT, DOWN])).toBe(DOWN);
  });
});
