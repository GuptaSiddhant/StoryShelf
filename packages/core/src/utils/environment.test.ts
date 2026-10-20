import { afterEach, describe, expect, it, vi } from "vitest";
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

/** Load a fresh module whose `fc-list` runs through `execFile`. */
async function withFcList(
  execFile: (...args: unknown[]) => void,
): Promise<typeof import("./environment.ts").systemFontsHash> {
  vi.resetModules();
  vi.spyOn(process, "getBuiltinModule").mockReturnValue({ execFile } as never);
  return (await import("./environment.ts")).systemFontsHash;
}

describe("systemFontsHash caching", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("retries after a failed run instead of caching it", async () => {
    let calls = 0;
    const hash = await withFcList((...args) => {
      calls += 1;
      const done = args.at(-1) as (error: Error | null, stdout: string) => void;
      done(calls === 1 ? Object.assign(new Error("timed out"), { code: null }) : null, "Arial\n");
    });
    expect(await hash()).toBeUndefined();
    const second = await hash();
    expect(second).toMatch(/^[0-9a-f]{16}$/u);
    expect(await hash()).toBe(second);
    expect(calls).toBe(2);
  });

  it("caches a missing fontconfig", async () => {
    let calls = 0;
    const hash = await withFcList((...args) => {
      calls += 1;
      const done = args.at(-1) as (error: Error | null, stdout: string) => void;
      done(Object.assign(new Error("not found"), { code: "ENOENT" }), "");
    });
    expect(await hash()).toBeUndefined();
    expect(await hash()).toBeUndefined();
    expect(calls).toBe(1);
  });
});
