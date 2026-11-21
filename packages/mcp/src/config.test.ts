import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./config.ts";

describe("resolveConfig", () => {
  it("reads env and trims trailing slashes", () => {
    expect(
      resolveConfig({ SHELF_URL: "https://s.example/", SHELF_TOKEN: "t", SHELF_SLUG: "web" }),
    ).toEqual({ url: "https://s.example", token: "t", slug: "web" });
  });

  it("lets overrides win", () => {
    expect(resolveConfig({ SHELF_URL: "http://a", SHELF_TOKEN: "x" }, { token: "y" })).toEqual({
      url: "http://a",
      token: "y",
    });
  });

  it("refuses an old name, naming it with its new name and never the value", () => {
    const secret = "secret-token-value";
    let message = "";
    try {
      resolveConfig({ SHELF_URL: "http://a", STORYSHELF_TOKEN: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("  STORYSHELF_TOKEN -> SHELF_TOKEN");
    expect(message).not.toContain(secret);
  });

  it("with SHELF_ALLOW_OLD_NAMES=1, warns on stderr with names only and starts", () => {
    const secret = "secret-token-value";
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(
        resolveConfig({
          SHELF_URL: "http://a",
          STORYSHELF_TOKEN: secret,
          SHELF_ALLOW_OLD_NAMES: "1",
        }),
      ).toEqual({ url: "http://a" });
      const printed = write.mock.calls.map((call) => String(call[0])).join("");
      expect(printed).toContain("STORYSHELF_TOKEN -> SHELF_TOKEN");
      expect(printed).not.toContain(secret);
    } finally {
      write.mockRestore();
    }
  });

  it("ignores old names of settings it does not read", () => {
    expect(resolveConfig({ SHELF_URL: "http://a", SECRET: "s" })).toEqual({ url: "http://a" });
  });

  it("throws without a url", () => {
    expect(() => resolveConfig({})).toThrow("SHELF_URL is required");
  });
});
