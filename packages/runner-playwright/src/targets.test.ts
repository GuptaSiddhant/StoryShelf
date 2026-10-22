import { describe, expect, it } from "vitest";
import { flattenBrowsers, local } from "./targets.ts";

describe("local", () => {
  it("describes a local engine with options", () => {
    expect(local("chrome", { channel: "chrome-beta" })).toEqual({
      kind: "local",
      engine: "chrome",
      options: { channel: "chrome-beta" },
    });
    expect(local("firefox").options).toEqual({});
  });

  it("refuses a channel on engines that have none, and unknown engines", () => {
    expect(() => local("firefox", { channel: "x" })).toThrow(
      /channel applies only to chromium and chrome/u,
    );
    expect(() => local("webkit", { channel: "x" })).toThrow(/webkit/u);
    expect(() => local("opera" as never)).toThrow(/unknown engine "opera"/u);
  });
});

describe("flattenBrowsers", () => {
  it("keeps the order, so the first entry is the default", () => {
    expect(flattenBrowsers(["webkit", "chromium"]).map((entry) => entry.target)).toEqual([
      "webkit",
      "chromium",
    ]);
  });

  it("launches bare chrome with the chrome channel and others with none", () => {
    expect(flattenBrowsers(["chrome", "chromium", "firefox"])).toEqual([
      { target: "chrome", channel: "chrome" },
      { target: "chromium", channel: undefined },
      { target: "firefox", channel: undefined },
    ]);
  });

  it("takes an explicit channel from local()", () => {
    expect(flattenBrowsers([local("chrome", { channel: "chrome-dev" })])[0]?.channel).toBe(
      "chrome-dev",
    );
    expect(flattenBrowsers([local("chromium", { channel: "chromium" })])[0]?.channel).toBe(
      "chromium",
    );
  });

  it("rejects an empty list and names the entries that collide", () => {
    expect(() => flattenBrowsers([])).toThrow(/at least one target/u);
    expect(() => flattenBrowsers(["chromium", "firefox", local("chromium")])).toThrow(
      /entries 1 and 3 both produce the target "chromium"/u,
    );
  });

  it("rejects an unknown engine name", () => {
    expect(() => flattenBrowsers(["opera" as never])).toThrow(/unknown engine/u);
  });
});
