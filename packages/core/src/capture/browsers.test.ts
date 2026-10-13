import { describe, expect, it } from "vitest";
import {
  assertBrowserCount,
  assertSupportedBrowsers,
  MAX_BROWSERS,
  parseBrowsers,
  resolveBrowsers,
} from "./browsers.ts";

describe("parseBrowsers", () => {
  it("parses and dedupes a stored list", () => {
    expect(parseBrowsers('["chromium","firefox","chromium"]')).toEqual(["chromium", "firefox"]);
  });

  it("returns null for unset, malformed or unknown engines", () => {
    expect(parseBrowsers(null)).toBeNull();
    expect(parseBrowsers("nope")).toBeNull();
    expect(parseBrowsers('["opera"]')).toBeNull();
    expect(parseBrowsers('"chromium"')).toBeNull();
  });
});

describe("resolveBrowsers", () => {
  it("prefers the browsers list, primary first", () => {
    expect(resolveBrowsers({ browser: "chromium", browsers: '["firefox","webkit"]' })).toEqual([
      "firefox",
      "webkit",
    ]);
  });

  it("falls back to the single legacy browser, then chromium", () => {
    expect(resolveBrowsers({ browser: "webkit", browsers: null })).toEqual(["webkit"]);
    expect(resolveBrowsers({})).toEqual(["chromium"]);
    expect(resolveBrowsers({ browser: "bogus" })).toEqual(["chromium"]);
  });

  it("rejects more than the cap", () => {
    const four = '["chromium","firefox","webkit","chrome"]';
    expect(() => resolveBrowsers({ browsers: four })).toThrow(`At most ${MAX_BROWSERS}`);
    expect(() => assertBrowserCount(["a", "b", "c", "d"])).toThrow(/At most 3/u);
  });
});

describe("assertSupportedBrowsers", () => {
  it("passes when the runner declares nothing or covers the list", () => {
    expect(() => assertSupportedBrowsers(["firefox"])).not.toThrow();
    expect(() => assertSupportedBrowsers(["chromium"], ["chromium", "firefox"])).not.toThrow();
  });

  it("names the unsupported engines", () => {
    expect(() => assertSupportedBrowsers(["chromium", "firefox"], ["chromium"])).toThrow(
      /does not support browser\(s\): firefox/u,
    );
  });
});
