import { describe, expect, it } from "vitest";
import { parseShutdownGraceMs, parseTrustProxy, validateConfig } from "./config.ts";

describe("validateConfig", () => {
  it("accepts the serverTiming opt-in", () => {
    expect(validateConfig({ serverTiming: true }).serverTiming).toBe(true);
  });

  it("leaves serverTiming unset by default", () => {
    expect(validateConfig({}).serverTiming).toBeUndefined();
  });

  it("validates the published compression opt-in", () => {
    expect(validateConfig({}).publishedCompression).toBeUndefined();
    expect(validateConfig({ publishedCompression: true }).publishedCompression).toBe(true);
    expect(() => validateConfig({ publishedCompression: "true" })).toThrow("Invalid ShelfConfig");
  });

  it("validates the capture asset cache opt-in: unset, 0 and 1 to 3600 whole seconds", () => {
    expect(validateConfig({}).captureAssets).toBeUndefined();
    expect(validateConfig({ captureAssets: {} }).captureAssets).toEqual({});
    for (const cacheMaxAgeSeconds of [0, 1, 600, 3600]) {
      expect(validateConfig({ captureAssets: { cacheMaxAgeSeconds } }).captureAssets).toEqual({
        cacheMaxAgeSeconds,
      });
    }
    for (const bad of [-1, 3601, 1.5, "60", Number.NaN]) {
      expect(() => validateConfig({ captureAssets: { cacheMaxAgeSeconds: bad } })).toThrow(
        "Invalid ShelfConfig",
      );
    }
    expect(() => validateConfig({ captureAssets: { headers: {} } })).toThrow("Invalid ShelfConfig");
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

describe("trustProxy", () => {
  it("accepts a hop count, a list of IPs and CIDRs, or fly", () => {
    expect(validateConfig({ trustProxy: 1 }).trustProxy).toBe(1);
    expect(validateConfig({ trustProxy: ["10.0.0.0/8", "::1"] }).trustProxy).toEqual([
      "10.0.0.0/8",
      "::1",
    ]);
    expect(validateConfig({ trustProxy: "fly" }).trustProxy).toBe("fly");
  });

  it("refuses zero, an empty list, host names and other strings", () => {
    expect(() => validateConfig({ trustProxy: 0 })).toThrow(/trustProxy/u);
    expect(() => validateConfig({ trustProxy: [] })).toThrow(/trustProxy/u);
    expect(() => validateConfig({ trustProxy: ["proxy.internal"] })).toThrow(/trustProxy/u);
    expect(() => validateConfig({ trustProxy: "true" })).toThrow(/trustProxy/u);
  });

  it("maps TRUST_PROXY values", () => {
    expect(parseTrustProxy()).toBeUndefined();
    expect(parseTrustProxy(" ")).toBeUndefined();
    expect(parseTrustProxy("false")).toBeUndefined();
    expect(parseTrustProxy("0")).toBeUndefined();
    expect(parseTrustProxy("fly")).toBe("fly");
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("10.0.0.0/16, 2001:db8::/32,")).toEqual([
      "10.0.0.0/16",
      "2001:db8::/32",
    ]);
  });
});

describe("parseShutdownGraceMs", () => {
  it("reads seconds as ms and treats anything else as unbounded", () => {
    expect(parseShutdownGraceMs("25")).toBe(25_000);
    expect(parseShutdownGraceMs("1.5")).toBe(1500);
    for (const raw of [undefined, "", "  ", "0", "-3", "soon"]) {
      expect(parseShutdownGraceMs(raw)).toBeUndefined();
    }
  });
});
