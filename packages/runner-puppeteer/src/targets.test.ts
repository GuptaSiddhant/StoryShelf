import { describe, expect, it } from "vitest";
import { cdp } from "./remote/cdp.ts";
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

const farm = () => cdp({ name: "farm", endpoint: "wss://farm/" });

describe("flattenBrowsers", () => {
  it("gives bare chromium the runner's executable and keeps the order", () => {
    expect(
      flattenBrowsers([local("chrome", { executablePath: "/c" }), "chromium"], "/usr/bin/chromium")
        .locals,
    ).toEqual([
      { target: "chrome", executablePath: "/c" },
      { target: "chromium", executablePath: "/usr/bin/chromium" },
    ]);
  });

  it("lets an entry's own executable win over the runner's", () => {
    expect(
      flattenBrowsers([local("chromium", { executablePath: "/own" })], "/runner").locals[0]
        ?.executablePath,
    ).toBe("/own");
  });

  it("leaves a bare chromium without an executable when the runner has none", () => {
    expect(flattenBrowsers(["chromium"]).locals[0]?.executablePath).toBeUndefined();
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

  it("expands a CDP service after the local entries, each target needing a URL", () => {
    const flat = flattenBrowsers(
      ["chromium", cdp({ name: "farm", endpoint: "wss://farm/", sessions: 3 })],
      "/c",
    );
    expect(flat.declared).toEqual([
      { target: "chromium", reach: "loopback", status: "ready" },
      { target: "chromium@farm", reach: "url", status: "ready" },
    ]);
    expect(flat.remotes.map((entry) => entry.target)).toEqual(["chromium@farm"]);
  });

  it("rejects two entries of one service, naming both", () => {
    expect(() => flattenBrowsers([farm(), farm()])).toThrow(
      /entries 1 and 2 both produce the target "chromium@farm"/u,
    );
  });
});
