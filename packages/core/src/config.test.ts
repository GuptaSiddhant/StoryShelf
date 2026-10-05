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
