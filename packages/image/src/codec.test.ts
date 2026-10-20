import { describe, expect, it } from "vitest";
import { isImageEngine, resolveImageEngine } from "./codec.ts";

describe("resolveImageEngine", () => {
  it("defaults to pngjs when blank", () => {
    expect([resolveImageEngine(""), resolveImageEngine("  ")]).toEqual(["pngjs", "pngjs"]);
  });

  it("accepts known engines, trimmed", () => {
    expect([resolveImageEngine(" sharp "), resolveImageEngine("pngjs")]).toEqual([
      "sharp",
      "pngjs",
    ]);
  });

  it("rejects unknown engines instead of falling back", () => {
    expect(() => resolveImageEngine("magick")).toThrow(/Unknown image engine "magick"/u);
    expect(() => resolveImageEngine("odiff")).toThrow(/pngjs, sharp/u);
  });
});

describe("isImageEngine", () => {
  it("accepts only known names", () => {
    expect([isImageEngine("sharp"), isImageEngine("pngjs"), isImageEngine("x")]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
