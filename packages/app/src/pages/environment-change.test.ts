import { describe, expect, it } from "vitest";
import { environmentChangeOf, labelOf, summariseEnvironmentChanges } from "./environment-change.ts";

const fingerprint = (browserVersion: string) => ({
  engine: "chromium",
  browserVersion,
  platform: "linux-x64",
  deviceScaleFactor: 1,
  fontsHash: null,
  viewport: { width: 1280, height: 720 },
  sizing: {},
});

const change = (from: string, to: string, changed = ["browserVersion"]) => ({
  envChange: JSON.stringify({ changed, from: fingerprint(from), to: fingerprint(to) }),
});

describe("environmentChangeOf", () => {
  it("parses a recorded change", () => {
    expect(environmentChangeOf(change("124", "126"))?.changed).toEqual(["browserVersion"]);
  });

  it("is null for no change, junk or a malformed value", () => {
    expect(environmentChangeOf({ envChange: null })).toBeNull();
    expect(environmentChangeOf({ envChange: "" })).toBeNull();
    expect(environmentChangeOf({ envChange: "not json" })).toBeNull();
    expect(environmentChangeOf({ envChange: '{"changed":"x"}' })).toBeNull();
  });
});

describe("summariseEnvironmentChanges", () => {
  it("is null when no snapshot was migrated", () => {
    expect(summariseEnvironmentChanges([{ envChange: null }, { envChange: null }])).toBeNull();
  });

  it("counts migrated snapshots and reports a shared browser version change", () => {
    const summary = summariseEnvironmentChanges([
      change("124", "126"),
      change("124", "126"),
      { envChange: null },
    ]);
    expect(summary).toEqual({
      count: 2,
      fields: ["browser version"],
      browserVersion: { from: "124", to: "126" },
    });
  });

  it("merges distinct fields and drops the version pair when snapshots disagree", () => {
    const summary = summariseEnvironmentChanges([
      change("124", "126"),
      change("120", "126", ["browserVersion", "fontsHash"]),
    ]);
    expect(summary?.fields).toEqual(["browser version", "installed fonts"]);
    expect(summary?.browserVersion).toBeUndefined();
  });

  it("labels unknown components as themselves", () => {
    expect(labelOf("fontsHash")).toBe("installed fonts");
    expect(labelOf("somethingNew")).toBe("somethingNew");
  });
});
