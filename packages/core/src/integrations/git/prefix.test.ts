import { describe, expect, it } from "vitest";
import { statusPrefixSchema } from "./prefix.ts";

describe("statusPrefixSchema", () => {
  it("accepts names usable in a status context", () => {
    for (const value of ["storyshelf", "storyshelf-web", "team_a.docs"]) {
      expect(statusPrefixSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects empty, spaced, slashed and oversized prefixes", () => {
    for (const value of ["", "my prefix", "a/b", "x".repeat(65)]) {
      expect(statusPrefixSchema.safeParse(value).success).toBe(false);
    }
  });
});
