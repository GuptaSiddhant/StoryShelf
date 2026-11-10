import { describe, expect, it, vi } from "vite-plus/test";
import {
  FONT_PROBE_FAMILIES,
  boundedProbe,
  inPageProbe,
  remoteEnvironment,
} from "./remote-environment.ts";

const hash = (fonts: string[]) => remoteEnvironment({ probe: { fonts } }).fontsHash;

describe("remoteEnvironment", () => {
  it("is built from what the browser reported, never from this host", () => {
    const environment = remoteEnvironment({
      browserVersion: "141.0.1",
      probe: { platform: "Linux x86_64", deviceScaleFactor: 2, fonts: ["Arial", "DejaVu Sans"] },
      declaredPlatform: "windows",
    });
    expect(environment).toEqual({
      browserVersion: "141.0.1",
      platform: "linux",
      deviceScaleFactor: 2,
      fontsHash: expect.stringMatching(/^[0-9a-f]{16}$/u),
    });
    expect(environment.platform).not.toContain(process.platform + "-");
  });

  it("hashes the same fonts to the same digest in any order, and others differently", () => {
    expect(hash(["B", "A"])).toBe(hash(["A", "B"]));
    expect(hash(["A"])).not.toBe(hash(["A", "B"]));
  });

  it("leaves out what the page could not tell, and falls back to the configured OS", () => {
    expect(remoteEnvironment({ probe: { fonts: [] } })).toEqual({});
    expect(remoteEnvironment({ declaredPlatform: "linux-x64" })).toEqual({
      platform: "linux-x64",
    });
    expect(remoteEnvironment({ probe: {}, browserVersion: "1" })).toEqual({ browserVersion: "1" });
  });

  it.each([
    ["Win32", "windows"],
    ["Windows", "windows"],
    ["MacIntel", "macos"],
    ["macOS", "macos"],
    ["Linux armv8l", "linux"],
    ["Android", "android"],
    ["  ", undefined],
  ])("reads %s as %s", (reported, expected) => {
    expect(remoteEnvironment({ probe: { platform: reported } }).platform).toBe(expected);
  });
});

/** Run `fn` with the browser globals the probe reads, faked. */
function withFakeBrowser<T>(measure: (font: string) => number, fn: () => T): T {
  const fake = {
    devicePixelRatio: 2,
    navigator: { platform: "Linux x86_64" },
    document: {
      createElement: () => ({
        getContext: () => {
          const context = { font: "", measureText: () => ({ width: measure(context.font) }) };
          return context;
        },
      }),
    },
  };
  const original = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(fake)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(fake)) {
      const previous = original[key];
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const present = (font: string): number => (font.includes('"Present"') ? 700 : 500);

describe("inPageProbe", () => {
  it("reports the platform, ratio and the probe fonts that measure differently", () => {
    withFakeBrowser(present, () => {
      expect(inPageProbe(["Present", "Absent"])).toEqual({
        platform: "Linux x86_64",
        deviceScaleFactor: 2,
        fonts: ["Present"],
      });
    });
  });

  it("is one self-contained function: rebuilt from its source with no module bindings it still runs", () => {
    // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
    const rebuilt = new Function(`return (${inPageProbe.toString()})`)() as typeof inPageProbe;
    withFakeBrowser(present, () => {
      expect(rebuilt(["Present"]).fonts).toEqual(["Present"]);
    });
  });

  it("probes a fixed, duplicate-free list", () => {
    expect(new Set(FONT_PROBE_FAMILIES).size).toBe(FONT_PROBE_FAMILIES.length);
  });
});

/** A promise settled from the outside, so a test decides the order of events. */
function gate<T = void>(): {
  promise: Promise<T>;
  open: (value: T) => void;
  fail: (e: Error) => void;
} {
  let open!: (value: T) => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

describe("boundedProbe", () => {
  it("returns what the work returned", async () => {
    const outcome = await boundedProbe({
      run: async () => await Promise.resolve(42),
      timeoutMs: 1000,
    });
    expect(outcome).toEqual({ status: "done", value: 42 });
  });

  it("reports an ordinary failure as failed, with the error", async () => {
    const error = new Error("service said no");
    const outcome = await boundedProbe({
      run: async () => await Promise.reject(error),
      timeoutMs: 1000,
    });
    expect(outcome).toEqual({ status: "failed", error });
  });

  it("stops waiting at the limit and tells the work it is stopped", async () => {
    const never = gate<number>();
    let control: { stopped: () => boolean } | undefined;
    const outcome = await boundedProbe({
      run: async (c) => {
        control = c;
        return await never.promise;
      },
      timeoutMs: 20,
    });
    expect(outcome).toEqual({ status: "timeout" });
    expect(control?.stopped()).toBe(true);
    never.open(1);
  });

  it("lets work that finishes after the limit release what it opened", async () => {
    const opened = gate();
    const closed = vi.fn();
    const outcome = await boundedProbe({
      run: async ({ stopped }) => {
        await opened.promise;
        if (stopped()) {
          closed();
        }
      },
      timeoutMs: 20,
    });
    expect(outcome.status).toBe("timeout");
    expect(closed).not.toHaveBeenCalled();
    opened.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toHaveBeenCalledOnce();
  });

  it("never leaves an unhandled rejection when the work fails after the limit", async () => {
    const late = gate();
    const outcome = await boundedProbe({
      run: async () => await late.promise,
      timeoutMs: 20,
    });
    expect(outcome.status).toBe("timeout");
    late.fail(new Error("too late to matter"));
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("is cancelled at once by the signal, without waiting for the limit or the work", async () => {
    const controller = new AbortController();
    const never = gate();
    const pending = boundedProbe({
      run: async () => await never.promise,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ status: "cancelled" });
    never.open();
  });

  it("does not start the work for a signal that has already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async () => await Promise.resolve(1));
    expect(await boundedProbe({ run, timeoutMs: 1000, signal: controller.signal })).toEqual({
      status: "cancelled",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("reads a failure after the signal fired as cancelled, not as an unknown environment", async () => {
    const controller = new AbortController();
    const outcome = await boundedProbe({
      run: async () => {
        controller.abort();
        return await Promise.reject(new Error("Target closed"));
      },
      timeoutMs: 1000,
      signal: controller.signal,
    });
    expect(outcome).toEqual({ status: "cancelled" });
  });

  it("does not mistake a signal that never fires for a cancel", async () => {
    const controller = new AbortController();
    const outcome = await boundedProbe({
      run: async () => await Promise.resolve("ok"),
      timeoutMs: 1000,
      signal: controller.signal,
    });
    expect(outcome).toEqual({ status: "done", value: "ok" });
  });
});
