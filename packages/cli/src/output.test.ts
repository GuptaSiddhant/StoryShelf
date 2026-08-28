import { afterEach, describe, expect, it, vi } from "vitest";

import { createSpinner, spinnerFrames } from "./output.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(spinnerFrames.every((frame) => typeof frame === "string" && frame.length > 0)).toBe(true);
  });
});

describe("createSpinner", () => {
  it("animates indeterminate frames while running and stops without a fake percentage", async () => {
    const writes = collectStdout();
    const spinner = createSpinner("Uploading...", spinnerFrames);
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    spinner.stop("Upload complete");

    const animations = writes.filter((chunk) => chunk.startsWith("\r") && chunk.includes("Uploading"));
    expect(animations.length).toBeGreaterThan(0);
    expect(writes.at(-1)).toBe("\rUpload complete\n");
    expect(animations.some((chunk) => chunk.includes("%"))).toBe(false);
  });

  it("uses the shared frames by default", async () => {
    const writes = collectStdout();
    const spinner = createSpinner("Working");
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    spinner.stop();

    const animation = writes.find((chunk) => chunk.startsWith("\r") && chunk.includes("Working"));
    expect(spinnerFrames.some((frame) => animation?.includes(frame))).toBe(true);
  });
});