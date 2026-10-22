import { describe, expect, it } from "vitest";
import { verifyLocalTargets } from "./availability.ts";
import { flattenBrowsers, local } from "./targets.ts";

const exists = (known: string[]) => (path: string) => known.includes(path);

describe("verifyLocalTargets", () => {
  it("is ready when the configured executable exists", () => {
    const targets = flattenBrowsers(["chromium"], "/usr/bin/chromium");
    expect(verifyLocalTargets(targets, {}, exists(["/usr/bin/chromium"]))).toEqual([
      { target: "chromium", reach: "loopback", status: "ready" },
    ]);
  });

  it("is unavailable, naming the path, when the executable is missing", () => {
    const targets = flattenBrowsers(["chromium"], "/usr/bin/chromium");
    expect(verifyLocalTargets(targets, {}, exists([]))[0]?.status).toEqual({
      unavailable: "executable not found at /usr/bin/chromium",
    });
  });

  it("is unavailable with no executable at all, since puppeteer-core ships no browser", () => {
    const status = verifyLocalTargets(flattenBrowsers(["chromium"]), {}, exists([]))[0]?.status;
    expect(status).toEqual({ unavailable: expect.stringContaining("no executablePath") });
  });

  it("reads PUPPETEER_EXECUTABLE_PATH for chromium, but never for chrome", () => {
    const env = { PUPPETEER_EXECUTABLE_PATH: "/env/chromium" };
    const chromium = flattenBrowsers(["chromium"]);
    expect(verifyLocalTargets(chromium, env, exists(["/env/chromium"]))[0]?.status).toBe("ready");
    const chrome = flattenBrowsers([local("chrome", { executablePath: "/chrome" })]);
    expect(verifyLocalTargets(chrome, env, exists(["/env/chromium"]))[0]?.status).toEqual({
      unavailable: "executable not found at /chrome",
    });
  });
});
