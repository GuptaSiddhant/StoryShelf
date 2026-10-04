import { describe, expect, it } from "vitest";
import { validateConfig } from "./config.ts";

describe("validateConfig", () => {
  it("accepts the serverTiming opt-in", () => {
    expect(validateConfig({ serverTiming: true }).serverTiming).toBe(true);
  });

  it("leaves serverTiming unset by default", () => {
    expect(validateConfig({}).serverTiming).toBeUndefined();
  });

  it("rejects non-boolean serverTiming", () => {
    expect(() => validateConfig({ serverTiming: "yes" })).toThrow("Invalid ShelfConfig");
  });
});
