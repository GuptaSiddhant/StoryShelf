import { remoteTargetsOf, type BrowserName } from "@storyshelf/core/adapter/capture-runner";
import { describe, expect, it } from "vitest";
import { playwrightVersion } from "../version.ts";
import { azurePlaywright } from "./azure.ts";
import { browserstack } from "./browserstack.ts";
import { playwrightServer } from "./playwright-server.ts";
import { remote } from "./remote.ts";

const summary = (service: ReturnType<typeof remote>) =>
  remoteTargetsOf(service).map(({ target, reach }) => `${target} ${reach}`);

/** The connection a service gives for `engine`: its fixed object, or what its function returns. */
const connectionOf = async (service: ReturnType<typeof remote>, engine: BrowserName) =>
  typeof service.connect === "function"
    ? await service.connect({
        engine,
        buildId: "b1",
        runId: "b1",
        purpose: "render",
        attempt: 1,
        signal: new AbortController().signal,
      })
    : service.connect;

const caps = async (service: ReturnType<typeof remote>, engine: BrowserName) => {
  const url = new URL((await connectionOf(service, engine)).endpoint);
  return {
    host: `${url.protocol}//${url.host}${url.pathname}`,
    caps: JSON.parse(url.searchParams.get("caps") ?? "{}") as Record<string, unknown>,
  };
};

describe("playwrightServer", () => {
  it("offers all three engines, routing the loopback Storybook through the connection", async () => {
    const service = playwrightServer({
      endpoint: "ws://playwright:3000/",
      sessions: 8,
      maxPagesPerConnection: 2,
    });
    expect(summary(service)).toEqual([
      "chromium@grid loopback",
      "firefox@grid loopback",
      "webkit@grid loopback",
    ]);
    expect(service.sessions).toBe(8);
    expect(service.maxPagesPerConnection).toBe(2);
    expect(service.protocol).toBe("playwright");
    expect(await connectionOf(service, "chromium")).toEqual({
      endpoint: "ws://playwright:3000/",
      headers: {},
    });
  });

  it("sends a proxy token as a bearer header and can switch exposeNetwork off", async () => {
    const service = playwrightServer({
      name: "farm",
      endpoint: "wss://farm.example/pw",
      token: "t0ken",
      headers: { "x-team": "ui" },
      exposeNetwork: false,
      engines: ["chromium"],
    });
    expect(await connectionOf(service, "chromium")).toEqual({
      endpoint: "wss://farm.example/pw",
      headers: { authorization: "Bearer t0ken", "x-team": "ui" },
    });
    expect(summary(service)).toEqual(["chromium@farm url"]);
    expect(service.sessions).toBe(1);
  });

  it("validates when created", () => {
    expect(() => playwrightServer({ endpoint: "http://not-a-websocket/" })).toThrow(/ws: or wss:/u);
    expect(() => playwrightServer({ endpoint: "ws://x/", name: "Bad Name" })).toThrow(/lowercase/u);
  });
});

describe("azurePlaywright", () => {
  const options = {
    endpoint: "wss://eastus.api.playwright.microsoft.com/playwrightworkspaces/abc/browsers",
    token: "az-token",
  };

  it("connects with the token, the OS and the API version, routing back through the connection", async () => {
    const service = azurePlaywright({ ...options, sessions: 20 });
    expect(summary(service)).toEqual([
      "chromium@azure loopback",
      "firefox@azure loopback",
      "webkit@azure loopback",
    ]);
    const connection = await connectionOf(service, "firefox");
    expect(new URL(connection.endpoint).searchParams.get("os")).toBe("linux");
    expect(new URL(connection.endpoint).searchParams.get("api-version")).toBe("2025-09-01");
    expect(connection.headers).toEqual({ authorization: "Bearer az-token" });
    expect(service.reach).toBe("loopback");
    expect(service.platform).toBe("linux");
  });

  it("takes the OS and API version it is given, and keeps what the endpoint already carries", async () => {
    const service = azurePlaywright({
      ...options,
      endpoint: `${options.endpoint}?os=windows`,
      os: "linux",
      apiVersion: "2099-01-01",
      engines: ["chromium"],
      name: "az2",
    });
    const url = new URL((await connectionOf(service, "chromium")).endpoint);
    expect(url.searchParams.get("os")).toBe("windows");
    expect(url.searchParams.get("api-version")).toBe("2099-01-01");
    expect(summary(service)).toEqual(["chromium@az2 loopback"]);
  });
});

describe("browserstack", () => {
  it("maps engines to BrowserStack's browsers, with the credentials in the capabilities", async () => {
    const service = browserstack({
      username: "user",
      accessKey: "key",
      os: { name: "Windows", version: "11" },
      engines: ["chromium", "chrome", "firefox", "webkit"],
      sessions: 5,
      build: "ui",
    });
    expect(await caps(service, "chromium")).toEqual({
      host: "wss://cdp.browserstack.com/playwright",
      caps: {
        browser: "playwright-chromium",
        browser_version: "latest",
        os: "Windows",
        os_version: "11",
        "browserstack.username": "user",
        "browserstack.accessKey": "key",
        "client.playwrightVersion": playwrightVersion(),
        build: "ui",
      },
    });
    expect((await caps(service, "chrome")).caps["browser"]).toBe("chrome");
    expect((await caps(service, "firefox")).caps["browser"]).toBe("playwright-firefox");
    expect((await caps(service, "webkit")).caps["browser"]).toBe("playwright-webkit");
    expect(service.platform).toBe("windows");
    expect(service.sessions).toBe(5);
  });

  it("cannot route back, so every target needs a URL", () => {
    const service = browserstack({ username: "u", accessKey: "k", engines: ["chromium"] });
    expect(summary(service)).toEqual(["chromium@browserstack url"]);
    expect(service.reach).toBe("url");
  });

  it("needs a name of its own for a second entry, and reads macOS as macos", async () => {
    const mac = browserstack({
      name: "bs-mac",
      username: "u",
      accessKey: "k",
      os: { name: "OS X", version: "Sonoma" },
      browserVersion: "17",
      engines: ["webkit"],
    });
    expect(summary(mac)).toEqual(["webkit@bs-mac url"]);
    expect(mac.platform).toBe("macos");
    expect((await caps(mac, "webkit")).caps["browser_version"]).toBe("17");
  });
});

describe("remote", () => {
  it("refuses an engine the connection cannot serve when it is created", () => {
    expect(() =>
      remote({
        name: "x",
        engines: ["firefox"],
        sessions: 1,
        protocol: "cdp",
        reach: "url",
        connect: { endpoint: "wss://x/" },
      }),
    ).toThrow(/CDP protocol drives Chromium only, not "firefox"/u);
  });
});
