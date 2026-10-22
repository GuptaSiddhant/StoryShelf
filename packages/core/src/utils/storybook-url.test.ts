import { describe, expect, it } from "vitest";
import { storybookBase } from "./storybook-url.ts";

describe("storybookBase", () => {
  it.each([
    ["https://app.example/_s/tok/projects/p/storybook/build/b/iframe.html"],
    ["https://app.example/_s/tok/projects/p/storybook/build/b/"],
    ["https://app.example/_s/tok/projects/p/storybook/build/b"],
    ["https://app.example/_s/tok/projects/p/storybook/build/b/iframe.html?id=x#frag"],
  ])("reduces %s to the build's root", (url) => {
    expect(storybookBase(url)).toBe("https://app.example/_s/tok/projects/p/storybook/build/b");
  });

  it("keeps a port and a bare origin", () => {
    expect(storybookBase("http://host:8080/")).toBe("http://host:8080");
  });

  it("throws on something that is not a URL", () => {
    expect(() => storybookBase("nope")).toThrow();
  });
});
