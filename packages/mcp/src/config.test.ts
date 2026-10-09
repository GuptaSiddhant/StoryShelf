import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.ts";

describe("resolveConfig", () => {
  it("reads env and trims trailing slashes", () => {
    expect(
      resolveConfig({
        STORYSHELF_URL: "https://s.example/",
        STORYSHELF_TOKEN: "t",
        STORYSHELF_SLUG: "web",
      }),
    ).toEqual({ url: "https://s.example", token: "t", slug: "web" });
  });

  it("accepts SHELF_TOKEN and lets overrides win", () => {
    expect(resolveConfig({ STORYSHELF_URL: "http://a", SHELF_TOKEN: "x" }, { token: "y" })).toEqual(
      {
        url: "http://a",
        token: "y",
      },
    );
  });

  it("throws without a url", () => {
    expect(() => resolveConfig({})).toThrow("STORYSHELF_URL");
  });
});
