import { describe, expect, it } from "vitest";
import { FONT_PROBE_FAMILIES, inPageProbe, remoteEnvironment } from "./remote-environment.ts";

const hash = (fonts: string[]) => remoteEnvironment({ probe: { fonts } }).fontsHash;

describe("remoteEnvironment", () => {
  it("is built from what the browser reported, never from this host", () => {
    const environment = remoteEnvironment({
      browserVersion: "141.0.1",
      probe: { platform: "Linux x86_64", deviceScaleFactor: 2, fonts: ["Arial", "DejaVu Sans"] },
      declaredPlatform: "windows",
    });
    expect(environment).toEqual({
      browserVersion: "141.0.1",
      platform: "linux",
      deviceScaleFactor: 2,
      fontsHash: expect.stringMatching(/^[0-9a-f]{16}$/u),
    });
    expect(environment.platform).not.toContain(process.platform + "-");
  });

  it("hashes the same fonts to the same digest in any order, and others differently", () => {
    expect(hash(["B", "A"])).toBe(hash(["A", "B"]));
    expect(hash(["A"])).not.toBe(hash(["A", "B"]));
  });

  it("leaves out what the page could not tell, and falls back to the configured OS", () => {
    expect(remoteEnvironment({ probe: { fonts: [] } })).toEqual({});
    expect(remoteEnvironment({ declaredPlatform: "linux-x64" })).toEqual({
      platform: "linux-x64",
    });
    expect(remoteEnvironment({ probe: {}, browserVersion: "1" })).toEqual({ browserVersion: "1" });
  });

  it.each([
    ["Win32", "windows"],
    ["Windows", "windows"],
    ["MacIntel", "macos"],
    ["macOS", "macos"],
    ["Linux armv8l", "linux"],
    ["Android", "android"],
    ["  ", undefined],
  ])("reads %s as %s", (reported, expected) => {
    expect(remoteEnvironment({ probe: { platform: reported } }).platform).toBe(expected);
  });
});

/** Run `fn` with the browser globals the probe reads, faked. */
function withFakeBrowser<T>(measure: (font: string) => number, fn: () => T): T {
  const fake = {
    devicePixelRatio: 2,
    navigator: { platform: "Linux x86_64" },
    document: {
      createElement: () => ({
        getContext: () => {
          const context = { font: "", measureText: () => ({ width: measure(context.font) }) };
          return context;
        },
      }),
    },
  };
  const original = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(fake)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(fake)) {
      const previous = original[key];
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const present = (font: string): number => (font.includes('"Present"') ? 700 : 500);

describe("inPageProbe", () => {
  it("reports the platform, ratio and the probe fonts that measure differently", () => {
    withFakeBrowser(present, () => {
      expect(inPageProbe(["Present", "Absent"])).toEqual({
        platform: "Linux x86_64",
        deviceScaleFactor: 2,
        fonts: ["Present"],
      });
    });
  });

  it("is one self-contained function: rebuilt from its source with no module bindings it still runs", () => {
    // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
    const rebuilt = new Function(`return (${inPageProbe.toString()})`)() as typeof inPageProbe;
    withFakeBrowser(present, () => {
      expect(rebuilt(["Present"]).fonts).toEqual(["Present"]);
    });
  });

  it("probes a fixed, duplicate-free list", () => {
    expect(new Set(FONT_PROBE_FAMILIES).size).toBe(FONT_PROBE_FAMILIES.length);
  });
});
