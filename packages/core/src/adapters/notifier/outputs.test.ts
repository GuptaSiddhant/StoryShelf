import { describe, expect, it } from "vitest";
import { ALL_OUTPUTS, cappedOutputs, isCommentMode, parseOutputs } from "./outputs.ts";

describe("outputs", () => {
  it("parses stored choices with defaults for what is missing or malformed", () => {
    expect(parseOutputs(null)).toEqual(ALL_OUTPUTS);
    expect(parseOutputs("not json")).toEqual(ALL_OUTPUTS);
    expect(parseOutputs("[]")).toEqual(ALL_OUTPUTS);
    expect(parseOutputs('{"storybook":false,"comment":"nope","annotations":"x"}')).toEqual({
      ...ALL_OUTPUTS,
      storybook: false,
    });
  });

  it("knows the comment modes", () => {
    expect(["always", "on-changes", "off"].every((mode) => isCommentMode(mode))).toBe(true);
    expect(isCommentMode("sometimes")).toBe(false);
    expect(isCommentMode(1)).toBe(false);
  });

  it("turns the comment off under a ceiling without pull-request writes", () => {
    expect(cappedOutputs(ALL_OUTPUTS, { pullRequests: false })).toEqual({
      ...ALL_OUTPUTS,
      comment: "off",
    });
    expect(cappedOutputs(ALL_OUTPUTS, { pullRequests: true })).toBe(ALL_OUTPUTS);
  });
});
