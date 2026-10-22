import { describe, expect, it } from "vitest";
import { storybookBase } from "./storybook-url.ts";

describe("storybookBase", () => {
  it("reduces the directory-root URL to the root without its slash", () => {
    expect(storybookBase("https://app.example/_s/tok/")).toBe("https://app.example/_s/tok");
    expect(storybookBase("https://app.example/base/_s/tok/")).toBe(
      "https://app.example/base/_s/tok",
    );
  });

  it("keeps a port and a bare origin", () => {
    expect(storybookBase("http://host:8080/")).toBe("http://host:8080");
  });

  it.each([
    ["https://app.example/_s/tok/iframe.html"],
    ["https://app.example/_s/tok"],
    ["https://app.example/_s/tok/?id=x"],
    ["https://app.example/_s/tok/#frag"],
  ])("refuses %s: only the directory root is accepted", (url) => {
    expect(() => storybookBase(url)).toThrow(/directory root/u);
  });

  it("does not quote the URL (it carries a token) and throws on something that is not a URL", () => {
    expect(() => storybookBase("https://app.example/_s/secret-token/iframe.html")).not.toThrow(
      /secret-token/u,
    );
    expect(() => storybookBase("nope")).toThrow();
  });
});
