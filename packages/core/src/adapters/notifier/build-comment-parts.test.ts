import { describe, expect, it } from "vitest";
import {
  changesSection,
  detailsSummary,
  failedTestsSection,
  removedSection,
} from "./build-comment-changes.ts";
import { actionLinks, approvalsText, headlineOf, openChanges } from "./build-comment-headline.ts";
import { escapeText, percentOf, plural, utcTime } from "./build-comment-text.ts";
import type { BuildCommentInput } from "./build-comment-types.ts";

const base: BuildCommentInput = {
  testing: true,
  status: "reviewing",
  sha: "abc1234",
  reviewUrl: "r",
  buildUrl: "b",
  counts: { snapshotCount: 10, changedCount: 4, approvedCount: 1, rejectedCount: 1 },
};

describe("build-comment-text", () => {
  it("formats counts, percents and times", () => {
    expect(plural(1, "change")).toBe("1 change");
    expect(plural(2, "change")).toBe("2 changes");
    expect(percentOf(0.024)).toBe("2.4 %");
    expect(percentOf(0.00001)).toBe("0.1 %");
    expect(percentOf(null)).toBeUndefined();
    expect(percentOf(Number.NaN)).toBeUndefined();
    expect(utcTime("2026-11-20T16:42:59Z")).toBe("16:42 UTC");
    expect(utcTime("nope")).toBeUndefined();
    expect(utcTime()).toBeUndefined();
  });

  it("escapes Markdown and collapses whitespace", () => {
    expect(escapeText(" a|b\n*c* ")).toBe("a\\|b \\*c\\*");
  });
});

describe("build-comment-headline", () => {
  it("counts open changes and words the headline", () => {
    expect(openChanges(base.counts)).toBe(2);
    expect(headlineOf(base)).toEqual({ emoji: "🟡", text: "2 visual changes need review" });
    expect(
      headlineOf({ ...base, counts: { ...base.counts, approvedCount: 0, rejectedCount: 3 } }).text,
    ).toBe("1 visual change needs review");
    expect(headlineOf({ ...base, status: "comparing" }).emoji).toBe("⏳");
    expect(headlineOf({ ...base, status: "failed" }).text).toBe("Capture failed");
    expect(headlineOf({ ...base, testing: false, status: "failed" }).text).toBe("Build failed");
    expect(headlineOf({ ...base, status: "cancelled" }).text).toBe("Cancelled");
  });

  it("never moves the headline for accessibility findings", () => {
    expect(headlineOf({ ...base, a11yCount: 9 })).toEqual(headlineOf(base));
  });

  it("shows approvals only while several are needed and the review waits", () => {
    expect(approvalsText({ ...base, approvals: { given: 1, required: 2 } })).toBe(
      "1 of 2 approvals",
    );
    expect(approvalsText({ ...base, approvals: { given: 1, required: 1 } })).toBeUndefined();
    expect(
      approvalsText({ ...base, status: "approved", approvals: { given: 2, required: 2 } }),
    ).toBeUndefined();
  });

  it("offers no approve link once the review is closed, and no retry without a link", () => {
    expect(actionLinks({ ...base, status: "rejected" })).not.toContain("Approve");
    expect(actionLinks({ ...base, status: "failed" })).toBe("[Build](b)");
    expect(actionLinks({ ...base, reviewUrl: "b" })).not.toContain("[Build]");
  });
});

describe("build-comment-changes", () => {
  it("renders nothing for nothing", () => {
    expect(changesSection([], 5)).toEqual([]);
    expect(failedTestsSection()).toEqual([]);
    expect(removedSection([])).toEqual([]);
    expect(detailsSummary({ ...base, status: "capturing" })).toBeUndefined();
  });

  it("lists failing tests and removed stories, cutting long lists", () => {
    const names = Array.from({ length: 12 }, (_, n) => `T${String(n)}`);
    expect(failedTestsSection(names)[0]).toContain("- …and 2 more");
    expect(failedTestsSection(["x"])[0]).toContain("1 failing Storybook test**");
    expect(removedSection(["A"])[0]).toContain("1 removed story");
    expect(removedSection(names)[0]).toContain("12 removed stories");
  });

  it("summarizes unchanged, a11y and history", () => {
    expect(
      detailsSummary({
        ...base,
        a11yCount: 1,
        earlier: [{ state: "x", sha: "1", url: "u" }],
      }),
    ).toBe("6 unchanged · 1 a11y finding · 1 earlier build");
  });
});
