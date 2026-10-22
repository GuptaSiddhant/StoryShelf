import { describe, expect, it } from "vitest";
import {
  TargetLaunchError,
  engineOf,
  isBrowserName,
  isCaptureTarget,
  parseTarget,
  tryParseTarget,
  unavailableReason,
} from "./capture-target.ts";

describe("parseTarget", () => {
  it("splits an engine and a remote target's name", () => {
    expect(parseTarget("firefox")).toEqual({ engine: "firefox" });
    expect(parseTarget("chromium@grid")).toEqual({ engine: "chromium", name: "grid" });
    expect(parseTarget("webkit@bs-mac-14")).toEqual({ engine: "webkit", name: "bs-mac-14" });
    expect(engineOf("chrome@azure")).toBe("chrome");
  });

  it("accepts a name of up to 32 characters, not 33", () => {
    expect(isCaptureTarget(`chromium@${"a".repeat(32)}`)).toBe(true);
    expect(isCaptureTarget(`chromium@${"a".repeat(33)}`)).toBe(false);
  });

  it("throws on anything that is not a target, naming what is valid", () => {
    expect(() => parseTarget("opera")).toThrow(/Invalid capture target "opera"/u);
    expect(() => parseTarget("chromium@Grid")).toThrow(/<engine>@<name>/u);
  });

  it("returns null instead of throwing from tryParseTarget", () => {
    expect(tryParseTarget(42)).toBeNull();
    expect(tryParseTarget("chromium@")).toBeNull();
    expect(tryParseTarget("chromium@a@b")).toBeNull();
    expect(tryParseTarget("@grid")).toBeNull();
  });
});

describe("helpers", () => {
  it("tells engines from other strings", () => {
    expect(isBrowserName("webkit")).toBe(true);
    expect(isBrowserName("webkit@x")).toBe(false);
    expect(isBrowserName(null)).toBe(false);
  });

  it("reads the reason of an unavailable status", () => {
    expect(unavailableReason("ready")).toBeNull();
    expect(unavailableReason({ unavailable: "no public origin" })).toBe("no public origin");
  });

  it("names the target in a launch error and keeps the cause", () => {
    const cause = new Error("spawn ENOENT");
    const error = new TargetLaunchError("firefox", "executable missing", { cause });
    expect(error.message).toBe("Cannot launch firefox: executable missing");
    expect(error.name).toBe("TargetLaunchError");
    expect(error.target).toBe("firefox");
    expect(error.cause).toBe(cause);
  });
});
