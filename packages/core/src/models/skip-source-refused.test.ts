import { describe, expect, it } from "vitest";
import { SkipSourceRefused } from "./skip-source-refused.ts";

describe("SkipSourceRefused", () => {
  it("is a named error carrying the reason", () => {
    const error = new SkipSourceRefused("moved");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "SkipSourceRefused", message: "moved" });
  });
});
