import { describe, expect, it } from "vitest";
import { assignmentReason } from "./review-assignment.ts";

describe("assignmentReason", () => {
  it.each([
    [["Button"], "You were asked to review this because you own Button."],
    [["Button", "Card"], "You were asked to review this because you own Button and Card."],
    [
      ["Button", "Card", "Chart"],
      "You were asked to review this because you own Button, Card and Chart.",
    ],
    [
      ["A", "B", "C", "D", "E"],
      "You were asked to review this because you own A, B, C and 2 more.",
    ],
  ])("%j", (components, expected) => {
    expect(assignmentReason(components)).toBe(expected);
  });
});
