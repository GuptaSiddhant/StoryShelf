import { describe, expect, it } from "vitest";
import { flattenBrowsers, local } from "./targets.ts";

describe("local", () => {
  it("describes a Chromium-family engine with an executable", () => {
    expect(local("chrome", { executablePath: "/usr/bin/google-chrome" })).toEqual({
      kind: "local",
      engine: "chrome",
      options: { executablePath: "/usr/bin/google-chrome" },
    });
  });

  it("refuses engines Puppeteer cannot drive, and unknown ones", () => {
    expect(() => local("firefox")).toThrow(/Chromium-family engines only/u);
    expect(() => local("webkit")).toThrow(/webkit/u);
    expect(() => local("opera" as never)).toThrow(/unknown engine "opera"/u);
  });
});

describe("flattenBrowsers", () => {
  it("gives bare chromium the runner's executable and keeps the order", () => {
    expect(
      flattenBrowsers([local("chrome", { executablePath: "/c" }), "chromium"], "/usr/bin/chromium"),
    ).toEqual([
      { target: "chrome", executablePath: "/c" },
      { target: "chromium", executablePath: "/usr/bin/chromium" },
    ]);
  });

  it("lets an entry's own executable win over the runner's", () => {
    expect(
      flattenBrowsers([local("chromium", { executablePath: "/own" })], "/runner")[0]
        ?.executablePath,
    ).toBe("/own");
  });

  it("leaves a bare chromium without an executable when the runner has none", () => {
    expect(flattenBrowsers(["chromium"])[0]?.executablePath).toBeUndefined();
  });

  it("rejects bare chrome, empty lists and duplicates", () => {
    expect(() => flattenBrowsers(["chrome"], "/runner")).toThrow(
      /"chrome" needs an executablePath/u,
    );
    expect(() => flattenBrowsers([])).toThrow(/at least one target/u);
    expect(() => flattenBrowsers(["chromium", local("chromium")])).toThrow(
      /entries 1 and 2 both produce the target "chromium"/u,
    );
  });
});
