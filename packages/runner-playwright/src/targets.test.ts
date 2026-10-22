import { describe, expect, it } from "vitest";
import { remote } from "./remote/remote.ts";
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

const targetsOf = (entries: Parameters<typeof flattenBrowsers>[0]) =>
  flattenBrowsers(entries).declared.map((entry) => entry.target);

const one = (name: string) =>
  remote({
    name,
    engines: ["chromium"],
    sessions: 1,
    connect: () => ({ protocol: "cdp", endpoint: "wss://x/" }),
  });

describe("flattenBrowsers", () => {
  it("keeps the order, so the first entry is the default", () => {
    expect(targetsOf(["webkit", "chromium"])).toEqual(["webkit", "chromium"]);
  });

  it("launches bare chrome with the chrome channel and others with none", () => {
    expect(flattenBrowsers(["chrome", "chromium", "firefox"]).locals).toEqual([
      { target: "chrome", channel: "chrome" },
      { target: "chromium", channel: undefined },
      { target: "firefox", channel: undefined },
    ]);
  });

  it("takes an explicit channel from local()", () => {
    expect(flattenBrowsers([local("chrome", { channel: "chrome-dev" })]).locals[0]?.channel).toBe(
      "chrome-dev",
    );
    expect(flattenBrowsers([local("chromium", { channel: "chromium" })]).locals[0]?.channel).toBe(
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

  it("expands a remote service into its targets after the entries before it", () => {
    const grid = remote({
      name: "grid",
      engines: ["chromium", "firefox"],
      sessions: 2,
      connect: () => ({
        protocol: "playwright",
        endpoint: "ws://farm/",
        exposeNetwork: "<loopback>",
      }),
    });
    const flat = flattenBrowsers(["chromium", grid]);
    expect(flat.declared).toEqual([
      { target: "chromium", reach: "loopback", status: "ready" },
      { target: "chromium@grid", reach: "loopback", status: "ready" },
      { target: "firefox@grid", reach: "loopback", status: "ready" },
    ]);
    expect(flat.locals).toHaveLength(1);
    expect(flat.remotes.map((entry) => entry.target)).toEqual(["chromium@grid", "firefox@grid"]);
  });

  it("marks a remote that cannot route back as needing a URL", () => {
    const farm = remote({
      name: "farm",
      engines: ["chromium"],
      sessions: 1,
      connect: () => ({ protocol: "cdp", endpoint: "wss://x/" }),
    });
    expect(flattenBrowsers([farm]).declared).toEqual([
      { target: "chromium@farm", reach: "url", status: "ready" },
    ]);
  });

  it("rejects two entries of one service, naming both", () => {
    expect(() => flattenBrowsers([one("a"), one("b"), one("a")])).toThrow(
      /entries 1 and 3 both produce the target "chromium@a"/u,
    );
  });
});
