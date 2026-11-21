import { describe, expect, it } from "vitest";
import { parseReadOnlyAccounts, readOnlyAccountMatcher, unsignedToken } from "./auth.ts";

describe("parseReadOnlyAccounts", () => {
  it("splits, trims and lowercases a comma-separated list", () => {
    expect(parseReadOnlyAccounts(" Demo@Example.test , ,viewer@example.test,")).toEqual([
      "demo@example.test",
      "viewer@example.test",
    ]);
  });

  it("reads an unset or blank value as no account", () => {
    expect(parseReadOnlyAccounts()).toEqual([]);
    expect(parseReadOnlyAccounts("  ")).toEqual([]);
  });
});

describe("readOnlyAccountMatcher", () => {
  const isReadOnly = readOnlyAccountMatcher(["Demo@Example.test", " "]);

  it("matches case-insensitively", () => {
    expect(isReadOnly("demo@example.test")).toBe(true);
    expect(isReadOnly("DEMO@EXAMPLE.TEST")).toBe(true);
    expect(isReadOnly(" demo@example.test ")).toBe(true);
  });

  it("never matches another, an empty or a missing email", () => {
    expect(isReadOnly("admin@example.test")).toBe(false);
    expect(isReadOnly("")).toBe(false);
    expect(isReadOnly(null)).toBe(false);
    expect(isReadOnly()).toBe(false);
  });

  it("compares in Unicode NFKC on both sides", () => {
    // "é" as one code point (NFC) and as "e" plus a combining accent (NFD).
    const nfc = "ren\u00E9@example.test";
    const nfd = "rene\u0301@example.test";
    expect(readOnlyAccountMatcher([nfc])(nfd)).toBe(true);
    expect(readOnlyAccountMatcher([nfd])(nfc)).toBe(true);
    // A compatibility form (full-width letters) folds to the plain address.
    expect(isReadOnly("\uFF24emo@example.test")).toBe(true);
    expect(parseReadOnlyAccounts(nfd)).toEqual([nfc]);
  });

  it("matches nothing without accounts", () => {
    expect(readOnlyAccountMatcher()("demo@example.test")).toBe(false);
  });
});

describe("unsignedToken", () => {
  it("drops the signature", () => {
    expect(unsignedToken("abc.sig")).toBe("abc");
  });
});
