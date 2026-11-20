import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReporter,
  createSpinner,
  describeByteProgress,
  describeFileProgress,
  formatBytes,
  formatDuration,
  isInteractive,
  spinnerFrames,
} from "./output.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Record the spinner interval and let the test fire it by hand. */
function installImmediateInterval(): (times: number) => void {
  const callbacks: (() => void)[] = [];
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => {
    callbacks.push(callback);
    return callbacks.length;
  }) as typeof setInterval);
  return (times) => {
    for (let index = 0; index < times; index += 1) callbacks.at(-1)?.();
  };
}

function collectStdout(): string[] {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((...args: unknown[]) => {
    writes.push(String(args[0]));
    return true;
  });
  return writes;
}

describe("spinnerFrames", () => {
  it("exports a shared indeterminate frame set", () => {
    expect(Array.isArray(spinnerFrames)).toBe(true);
    expect(spinnerFrames.length).toBeGreaterThan(0);
    expect(spinnerFrames.every((frame) => typeof frame === "string" && frame.length > 0)).toBe(
      true,
    );
  });
});

describe("createSpinner", () => {
  it("animates indeterminate frames while running and stops without a fake percentage", async () => {
    const writes = collectStdout();
    const tick = installImmediateInterval();
    const spinner = createSpinner("Uploading...", spinnerFrames);
    tick(4);
    spinner.stop("Upload complete");

    const animations = writes.filter(
      (chunk) => chunk.startsWith("\r") && chunk.includes("Uploading"),
    );
    expect(animations.length).toBeGreaterThan(0);
    expect(writes.at(-1)).toBe("\rUpload complete\n");
    expect(animations.some((chunk) => chunk.includes("%"))).toBe(false);
  });

  it("uses the shared frames by default", async () => {
    const writes = collectStdout();
    const tick = installImmediateInterval();
    const spinner = createSpinner("Working");
    tick(2);
    spinner.stop();

    const animation = writes.find((chunk) => chunk.startsWith("\r") && chunk.includes("Working"));
    expect(spinnerFrames.some((frame) => animation?.includes(frame))).toBe(true);
  });
});

/** A clock that advances 1.5s per reading. */
function clock(): () => number {
  let tick = 0;
  return () => (tick += 1500);
}

describe("reporter", () => {
  it("formats durations and sizes", () => {
    expect(formatDuration(400)).toBe("0.4s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(19_188_121)).toBe("18.3 MiB");
    expect(describeByteProgress(50, 200)).toBe("25% of 200 B");
    expect(describeFileProgress(120, 860)).toBe("120/860 files");
  });

  it("closes a failed phase with its time and rethrows the original error", async () => {
    let out = "";
    const reporter = createReporter({
      interactive: false,
      now: clock(),
      write: (text) => {
        out += text;
      },
    });
    const boom = new Error("boom");
    await expect(
      reporter.phase("Uploading", "Uploaded", async () => await Promise.reject(boom)),
    ).rejects.toBe(boom);
    expect(out).toBe("==> Uploading\n--> Failed: Uploading (1.5s)\n");
  });

  it("drops progress text outside a terminal and bolds only with color", async () => {
    let out = "";
    const reporter = createReporter({
      interactive: false,
      color: true,
      now: clock(),
      write: (text) => {
        out += text;
      },
    });
    await reporter.phase("Work", "Worked", async (handle) => {
      handle.progress("42% of 1.0 KiB");
      await Promise.resolve();
    });
    expect(out).toBe("\u001B[1m==> Work\u001B[22m\n--> Worked (1.5s)\n");
  });

  it("is interactive only on a terminal and without CI", () => {
    expect(isInteractive({}, true)).toBe(true);
    expect(isInteractive({ CI: "true" }, true)).toBe(false);
    expect(isInteractive({}, false)).toBe(false);
  });
});
