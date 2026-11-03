import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_VERSION,
  buildFingerprint,
  changedFields,
  fingerprintHash,
  measurementVersionOf,
  mergeFingerprint,
  parseFingerprint,
  remeasuredFields,
  unknownFields,
} from "./fingerprint.ts";

const viewport = { name: "desktop", width: 1280, height: 720 };
const env = {
  browserVersion: "124.0.1",
  platform: "linux-x64",
  deviceScaleFactor: 1,
  fontsHash: "abc123",
};

describe("fingerprint", () => {
  it("hashes identical captures identically, regardless of viewport name", () => {
    const first = fingerprintHash(buildFingerprint("chromium", viewport, env));
    const second = fingerprintHash(
      buildFingerprint("chromium", { ...viewport, name: "other" }, { ...env }),
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    ["engine", () => buildFingerprint("firefox", viewport, env)],
    [
      "browserVersion",
      () => buildFingerprint("chromium", viewport, { ...env, browserVersion: "125.0.0" }),
    ],
    [
      "platform",
      () => buildFingerprint("chromium", viewport, { ...env, platform: "darwin-arm64" }),
    ],
    [
      "deviceScaleFactor",
      () => buildFingerprint("chromium", viewport, { ...env, deviceScaleFactor: 2 }),
    ],
    ["fontsHash", () => buildFingerprint("chromium", viewport, { ...env, fontsHash: "other" })],
    ["viewport", () => buildFingerprint("chromium", { ...viewport, width: 800 }, env)],
  ])("changes the hash when %s changes", (_name, change) => {
    const base = fingerprintHash(buildFingerprint("chromium", viewport, env));
    expect(fingerprintHash(change())).not.toBe(base);
  });

  it("treats a runner that reports nothing as a stable fingerprint", () => {
    const first = buildFingerprint("chromium", viewport, {});
    expect(first.browserVersion).toBeNull();
    expect(fingerprintHash(first)).toBe(
      fingerprintHash(buildFingerprint("chromium", viewport, {})),
    );
  });

  it("names the components that differ", () => {
    const from = buildFingerprint("chromium", viewport, env);
    const to = buildFingerprint(
      "chromium",
      { ...viewport, height: 800 },
      {
        ...env,
        browserVersion: "125.0.0",
      },
    );
    // Viewport size comes from story code: it diffs, it is not an environment change.
    expect(changedFields(from, to)).toEqual(["browserVersion"]);
    expect(changedFields(from, from)).toEqual([]);
  });

  it("treats a component either side did not report as unknown, not changed", () => {
    const known = buildFingerprint("chromium", viewport, env);
    const unknown = buildFingerprint("chromium", viewport, {});
    expect(changedFields(known, unknown)).toEqual([]);
    expect(changedFields(unknown, known)).toEqual([]);
    const partial = buildFingerprint("chromium", viewport, { ...env, fontsHash: undefined });
    expect(changedFields(known, { ...partial, browserVersion: "125.0.0" })).toEqual([
      "browserVersion",
    ]);
  });

  it("merges a capture's unknown components from the earlier fingerprint", () => {
    const earlier = buildFingerprint("chromium", viewport, env);
    const now = buildFingerprint("chromium", viewport, { browserVersion: "125.0.0" });
    expect(mergeFingerprint(earlier, now)).toEqual({ ...earlier, browserVersion: "125.0.0" });
    expect(mergeFingerprint(null, now)).toEqual(now);
  });

  it("reports unknown when the earlier fingerprint was not recorded", () => {
    expect(changedFields(null, buildFingerprint("chromium", viewport, env))).toEqual(["unknown"]);
  });

  it("round-trips through JSON and rejects junk", () => {
    const fingerprint = buildFingerprint("chromium", viewport, env);
    expect(parseFingerprint(JSON.stringify(fingerprint))).toEqual(fingerprint);
    expect(parseFingerprint(null)).toBeNull();
    expect(parseFingerprint("")).toBeNull();
    expect(parseFingerprint("not json")).toBeNull();
    expect(parseFingerprint('{"foo":1}')).toBeNull();
  });
});

/** Pretend version 2 changed how the fonts and the platform are measured. */
const history = { 2: ["fontsHash", "platform"] } as const;
const v1 = () => ({ ...buildFingerprint("chromium", viewport, env), measurementVersion: 1 });
const v2 = (extra: Partial<ReturnType<typeof v1>> = {}) => ({
  ...buildFingerprint("chromium", viewport, env),
  measurementVersion: 2,
  ...extra,
});

describe("measurement version", () => {
  it("writes the current version, and reads a fingerprint without one as version 1", () => {
    expect(buildFingerprint("chromium", viewport, env).measurementVersion).toBe(
      MEASUREMENT_VERSION,
    );
    const { measurementVersion: _dropped, ...legacy } = v1();
    expect(measurementVersionOf(legacy)).toBe(1);
    expect(parseFingerprint(JSON.stringify(legacy))).toEqual(legacy);
  });

  it("hashes a version-1 fingerprint identically with or without the field, and any version alike", () => {
    const { measurementVersion: _dropped, ...legacy } = v1();
    expect(fingerprintHash(v1())).toBe(fingerprintHash(legacy));
    expect(fingerprintHash(v2())).toBe(fingerprintHash(v1()));
  });

  it("keeps a same-version comparison unchanged", () => {
    expect(changedFields(v1(), v1(), history)).toEqual([]);
    expect(changedFields(v2(), v2({ fontsHash: "other" }), history)).toEqual(["fontsHash"]);
    expect(unknownFields(v2(), v2(), history)).toEqual([]);
    expect(remeasuredFields(v1(), v1(), history)).toEqual([]);
  });

  it("compares a component measured differently across versions as unknown, not changed", () => {
    const earlier = v1();
    const now = v2({ fontsHash: "measured-another-way", platform: "darwin-arm64" });
    expect(changedFields(earlier, now, history)).toEqual([]);
    expect(unknownFields(earlier, now, history)).toHaveLength(["fontsHash", "platform"].length);
    expect(unknownFields(earlier, now, history)).toEqual(
      expect.arrayContaining(["fontsHash", "platform"]),
    );
    // Components measured the same way in both versions still compare.
    expect(changedFields(earlier, { ...now, browserVersion: "125.0.0" }, history)).toEqual([
      "browserVersion",
    ]);
    // The hash differs (values differ), but the comparison never calls it a migration.
    expect(fingerprintHash(earlier)).not.toBe(fingerprintHash(now));
  });

  it("compares in either direction, and across several versions", () => {
    const now = v2({ fontsHash: "other" });
    expect(changedFields(now, v1(), history)).toEqual([]);
    expect(unknownFields(now, v1(), history)).toHaveLength(["fontsHash", "platform"].length);
    expect(unknownFields(now, v1(), history)).toEqual(
      expect.arrayContaining(["fontsHash", "platform"]),
    );
    const v3 = { ...v2(), measurementVersion: 3 };
    expect(unknownFields(v1(), v3, { ...history, 3: ["engine"] })).toHaveLength(
      ["engine", "fontsHash", "platform"].length,
    );
    expect(unknownFields(v1(), v3, { ...history, 3: ["engine"] })).toEqual(
      expect.arrayContaining(["engine", "fontsHash", "platform"]),
    );
    expect(unknownFields(v2(), v3, { ...history, 3: ["engine"] })).toEqual(["engine"]);
  });

  it("treats a remeasured sizing as unknown too", () => {
    const now = { ...v2(), sizing: { ...v2().sizing, deviceScaleFactor: 9 } as never };
    expect(changedFields(v1(), now, { 2: ["sizing"] })).toEqual([]);
    expect(changedFields(v1(), now, {})).toEqual(["sizing"]);
  });

  it("reports nothing unknown without an earlier fingerprint", () => {
    expect(unknownFields(null, v2(), history)).toEqual([]);
  });

  it("does not carry an earlier value over a remeasured component when the capture lacks it", () => {
    const earlier = v1();
    const now = { ...v2({ fontsHash: null, browserVersion: "125.0.0" }) };
    const merged = mergeFingerprint(earlier, now, history);
    expect(merged.fontsHash).toBeNull();
    expect(merged.platform).toBe(earlier.platform);
    expect(merged.measurementVersion).toBe(2);
    // Within one version the earlier value is kept, as before.
    expect(mergeFingerprint(earlier, { ...v1(), fontsHash: null }, history).fontsHash).toBe(
      earlier.fontsHash,
    );
  });
});
