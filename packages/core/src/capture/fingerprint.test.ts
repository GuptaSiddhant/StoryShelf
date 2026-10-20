import { describe, expect, it } from "vitest";
import {
  buildFingerprint,
  changedFields,
  fingerprintHash,
  mergeFingerprint,
  parseFingerprint,
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
