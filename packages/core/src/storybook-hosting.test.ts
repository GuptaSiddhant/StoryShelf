import { describe, expect, it } from "vitest";
import { validateConfig } from "./config.ts";
import { normalizeBaseDomain, validateStorybookHosting } from "./storybook-hosting.ts";

describe("normalizeBaseDomain", () => {
  it("lower-cases and drops one trailing dot", () => {
    expect(normalizeBaseDomain("Shelf.Example.COM.")).toEqual({
      ok: true,
      value: "shelf.example.com",
    });
  });

  it.each([
    "",
    "example.com:8080",
    "https://example.com",
    "*.example.com",
    "-bad.example.com",
    "exa mple.com",
    "a..b",
    "example.com..",
    `${"a".repeat(64)}.com`,
  ])("refuses %j", (value) => {
    expect(normalizeBaseDomain(value)).toEqual({ ok: false });
  });
});

describe("validateStorybookHosting", () => {
  it("keeps trusted and sandboxed as given", () => {
    expect(validateStorybookHosting({ mode: "trusted" })).toEqual({ mode: "trusted" });
    expect(validateStorybookHosting({ mode: "sandboxed" })).toEqual({ mode: "sandboxed" });
  });

  it("refuses a baseDomain on a mode that has no content hosts", () => {
    expect(() => validateStorybookHosting({ mode: "sandboxed", baseDomain: "a.com" })).toThrow(
      /only for the "subdomain" mode/u,
    );
  });

  it("requires a baseDomain for subdomain", () => {
    expect(() => validateStorybookHosting({ mode: "subdomain" })).toThrow(/required/u);
  });

  it("normalizes the baseDomain of subdomain and refuses a bad one", () => {
    expect(validateStorybookHosting({ mode: "subdomain", baseDomain: "A.com." })).toEqual({
      mode: "subdomain",
      baseDomain: "a.com",
    });
    expect(() => validateStorybookHosting({ mode: "subdomain", baseDomain: "*.a.com" })).toThrow(
      /plain domain/u,
    );
  });
});

describe("validateConfig storybookHosting", () => {
  it("leaves an unset value unset, which means trusted", () => {
    expect(validateConfig({}).storybookHosting).toBeUndefined();
  });

  it("refuses a missing or unknown mode and extra keys, never falling back", () => {
    expect(() => validateConfig({ storybookHosting: {} })).toThrow(/Invalid ShelfConfig/u);
    expect(() => validateConfig({ storybookHosting: { mode: "open" } })).toThrow(
      /Invalid ShelfConfig/u,
    );
    expect(() => validateConfig({ storybookHosting: { mode: "trusted", extra: 1 } })).toThrow(
      /Invalid ShelfConfig/u,
    );
  });

  it("refuses publishedBaseDomain together with storybookHosting", () => {
    expect(() =>
      validateConfig({ publishedBaseDomain: "a.com", storybookHosting: { mode: "trusted" } }),
    ).toThrow(/both set/u);
  });

  it("normalizes the baseDomain it returns and words a refusal as an invalid config", () => {
    const config = validateConfig({
      storybookHosting: { mode: "subdomain", baseDomain: "A.com." },
    });
    expect(config.storybookHosting).toEqual({ mode: "subdomain", baseDomain: "a.com" });
    expect(() =>
      validateConfig({ storybookHosting: { mode: "subdomain", baseDomain: "a.com:80" } }),
    ).toThrow(/Invalid ShelfConfig: storybookHosting.baseDomain/u);
  });
});
