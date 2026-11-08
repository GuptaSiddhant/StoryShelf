import { describe, expect, it } from "vitest";
import {
  axeUnavailableNote,
  axeUnavailableReason,
  baselineNote,
  baselineSha,
  isA11yNote,
  parametersNote,
  parametersReason,
} from "./notes.ts";

describe("a11y notes", () => {
  it("round-trips each note and tells it from the other two", () => {
    const unavailable = axeUnavailableNote("blocked");
    const parameters = parametersNote("cyclic value");
    const baseline = baselineNote("0123456789abcdef");
    expect(unavailable).toBe("axe unavailable: blocked");
    expect(axeUnavailableReason(unavailable)).toBe("blocked");
    expect(parametersReason(parameters)).toBe("cyclic value");
    expect(baselineSha(baseline)).toBe("0123456");
    expect(parametersReason(unavailable)).toBeUndefined();
    expect(baselineSha(parameters)).toBeUndefined();
    expect(axeUnavailableReason(baseline)).toBeUndefined();
  });

  it("counts a note as a note and a violation text as a finding", () => {
    for (const note of [axeUnavailableNote("x"), parametersNote("x"), baselineNote("abc1234")]) {
      expect(isA11yNote(note)).toBe(true);
    }
    expect(isA11yNote("color-contrast (serious): Elements must have contrast [a] 1 node")).toBe(
      false,
    );
    expect(isA11yNote("…and 3 more")).toBe(false);
  });
});
