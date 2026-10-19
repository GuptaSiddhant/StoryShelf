import { describe, expect, it } from "vitest";
import { detectCaptureEnvironment, systemFontsHash } from "./environment.ts";

describe("detectCaptureEnvironment", () => {
  it("reports platform, scale factor and the browser version it is given", async () => {
    const env = await detectCaptureEnvironment("124.0.1");
    expect(env.browserVersion).toBe("124.0.1");
    expect(env.platform).toBe(`${process.platform}-${process.arch}`);
    expect(env.deviceScaleFactor).toBe(1);
  });

  it("omits the version when the driver gave none, and honours the scale factor", async () => {
    const env = await detectCaptureEnvironment(undefined, 2);
    expect(env).not.toHaveProperty("browserVersion");
    expect(env.deviceScaleFactor).toBe(2);
  });

  it("returns a stable font digest or nothing, never throws", async () => {
    const first = await systemFontsHash();
    expect(first === undefined || /^[0-9a-f]{16}$/u.test(first)).toBe(true);
    expect(await systemFontsHash()).toBe(first);
  });
});
