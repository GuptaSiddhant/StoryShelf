import { describe, expect, it } from "vite-plus/test";
import { storageKey } from "./keys.ts";

describe("storageKey", () => {
  it("joins a Windows relative path with forward slashes", () => {
    expect(storageKey(String.raw`p1\content\abc.png`, "\\")).toBe("p1/content/abc.png");
  });

  it("leaves a POSIX relative path as is", () => {
    expect(storageKey("p1/content/abc.png", "/")).toBe("p1/content/abc.png");
  });
});
