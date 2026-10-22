import { describe, expect, it } from "vitest";
import type { RunnerTarget } from "../adapters/capture-runner.ts";
import {
  assertBrowserCount,
  assertSupportedBrowsers,
  MAX_BROWSERS,
  parseBrowsers,
  refusalFor,
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

describe("targets", () => {
  it("parses and dedupes remote targets next to engines", () => {
    expect(parseBrowsers('["chromium","chromium@grid","chromium@grid","webkit@bs-mac"]')).toEqual([
      "chromium",
      "chromium@grid",
      "webkit@bs-mac",
    ]);
  });

  it("rejects a target whose name or engine is not valid", () => {
    expect(parseBrowsers('["chromium@"]')).toBeNull();
    expect(parseBrowsers('["chromium@Grid"]')).toBeNull();
    expect(parseBrowsers('["chromium@-x"]')).toBeNull();
    expect(parseBrowsers('["chromium@a/b"]')).toBeNull();
    expect(parseBrowsers('["opera@grid"]')).toBeNull();
  });

  it("resolves a single remote target from the legacy column", () => {
    expect(resolveBrowsers({ browser: "firefox@pool-b" })).toEqual(["firefox@pool-b"]);
  });
});

describe("refusalFor", () => {
  const offered: RunnerTarget[] = [
    { target: "chromium", reach: "loopback", status: "ready" },
    { target: "firefox", reach: "loopback", status: { unavailable: "declared, not installed" } },
  ];

  it("accepts anything when the runner publishes no list", () => {
    expect(refusalFor("webkit")).toBeNull();
  });

  it("accepts a ready target, names an unavailable one and lists what is offered", () => {
    expect(refusalFor("chromium", offered)).toBeNull();
    expect(refusalFor("firefox", offered)).toBe("firefox is unavailable: declared, not installed");
    expect(refusalFor("webkit@grid", offered)).toBe(
      "webkit@grid is not offered by this capture runner (offered: chromium, firefox)",
    );
    expect(refusalFor("chromium", [])).toContain("(offered: none)");
  });
});

describe("assertSupportedBrowsers", () => {
  const offered: RunnerTarget[] = [
    { target: "chromium", reach: "loopback", status: "ready" },
    { target: "chromium@grid", reach: "loopback", status: "ready" },
  ];

  it("passes when the runner declares nothing or covers the list", () => {
    expect(() => assertSupportedBrowsers(["firefox"])).not.toThrow();
    expect(() => assertSupportedBrowsers(["chromium", "chromium@grid"], offered)).not.toThrow();
  });

  it("names every target the runner cannot render", () => {
    expect(() => assertSupportedBrowsers(["chromium", "firefox", "webkit"], offered)).toThrow(
      /firefox is not offered.*; webkit is not offered/u,
    );
  });
});
