import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTokenFlagWarning, warnTokenFlag } from "./token-flag.ts";

let written: string;

beforeEach(() => {
  written = "";
  resetTokenFlagWarning();
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("warnTokenFlag", () => {
  it("names the flag and the variable, never the value", () => {
    warnTokenFlag("shelf_super_secret");
    expect(written).toContain("--token");
    expect(written).toContain("SHELF_TOKEN");
    expect(written).not.toContain("shelf_super_secret");
  });

  it("says nothing without the flag, and only once", () => {
    warnTokenFlag();
    expect(written).toBe("");
    warnTokenFlag("a");
    warnTokenFlag("b");
    expect(written.match(/--token/gu)).toHaveLength(1);
  });
});
