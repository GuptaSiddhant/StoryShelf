import { describe, expect, it } from "vitest";
import { validateConfig } from "./config.ts";

describe("validateConfig", () => {
  it("accepts the serverTiming opt-in", () => {
    expect(validateConfig({ serverTiming: true }).serverTiming).toBe(true);
  });

  it("leaves serverTiming unset by default", () => {
    expect(validateConfig({}).serverTiming).toBeUndefined();
  });

  it("rejects non-boolean serverTiming", () => {
    expect(() => validateConfig({ serverTiming: "yes" })).toThrow("Invalid ShelfConfig");
  });
});

describe("validateConfig secret rotation", () => {
  it("accepts previousSecret alongside a different secret", () => {
    const config = validateConfig({ secret: "new", previousSecret: "old" });
    expect(config.previousSecret).toBe("old");
  });

  it("accepts migrateCredentialsOnBoot", () => {
    expect(
      validateConfig({ secret: "new", previousSecret: "old", migrateCredentialsOnBoot: true })
        .migrateCredentialsOnBoot,
    ).toBe(true);
  });

  it("rejects previousSecret without secret", () => {
    expect(() => validateConfig({ previousSecret: "old" })).toThrow(
      "previousSecret requires secret",
    );
  });

  it("rejects previousSecret equal to secret", () => {
    expect(() => validateConfig({ secret: "same", previousSecret: "same" })).toThrow("must differ");
  });

  it("does not take an array of previous secrets", () => {
    expect(() => validateConfig({ secret: "new", previousSecret: ["old"] })).toThrow(
      "Invalid ShelfConfig",
    );
  });
});

describe("validateConfig publish limits", () => {
  it("accepts the three limits", () => {
    const config = validateConfig({
      maxInlineUnzipSize: 1024,
      maxZipEntries: 5000,
      maxUnzippedBytes: 1e9,
    });
    expect(config).toMatchObject({
      maxInlineUnzipSize: 1024,
      maxZipEntries: 5000,
      maxUnzippedBytes: 1e9,
    });
  });

  it("accepts 0 inline bytes (every zip becomes a publish job)", () => {
    expect(validateConfig({ maxInlineUnzipSize: 0 }).maxInlineUnzipSize).toBe(0);
  });

  it.each([
    ["maxInlineUnzipSize", -1],
    ["maxInlineUnzipSize", 1.5],
    ["maxZipEntries", 0],
    ["maxUnzippedBytes", 0],
    ["maxUnzippedBytes", "big"],
  ])("rejects %s = %s", (key, value) => {
    expect(() => validateConfig({ [key]: value })).toThrow();
  });
});
