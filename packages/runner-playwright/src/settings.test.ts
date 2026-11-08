import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSettings } from "./settings.ts";

/** The settings for the given environment and options. */
function settingsFor(
  env: Record<string, string>,
  options: Parameters<typeof resolveSettings>[0] = {},
): ReturnType<typeof resolveSettings> {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  return resolveSettings(options);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSettings from the environment", () => {
  it.each([
    ["8", 8],
    [" 8", 8],
    ["+8", 8],
    ["12abc", 12],
    ["0", undefined],
    ["", undefined],
    ["abc", undefined],
    ["-3", undefined],
  ])("reads STORYSHELF_CAPTURE_CONCURRENCY=%j as %j", (raw, expected) => {
    expect(settingsFor({ STORYSHELF_CAPTURE_CONCURRENCY: raw }).concurrency).toBe(expected);
  });

  it.each([
    ["0", 0],
    ["25", 25],
    ["", undefined],
    ["x", undefined],
  ])("reads STORYSHELF_BROWSER_RECYCLE_EVERY=%j as %j", (raw, expected) => {
    expect(settingsFor({ STORYSHELF_BROWSER_RECYCLE_EVERY: raw }).recycleBrowserEvery).toBe(
      expected,
    );
  });

  it("reads STORYSHELF_NAVIGATION_TIMEOUT_MS, else a detected default", () => {
    expect(settingsFor({ STORYSHELF_NAVIGATION_TIMEOUT_MS: "9000" }).navigationTimeoutMs).toBe(
      9000,
    );
    expect(
      settingsFor({ STORYSHELF_NAVIGATION_TIMEOUT_MS: "x" }).navigationTimeoutMs,
    ).toBeGreaterThan(0);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["", false],
  ])("reads STORYSHELF_REUSE_PAGES=%j as %j", (raw, expected) => {
    expect(settingsFor({ STORYSHELF_REUSE_PAGES: raw }).reusePages).toBe(expected);
  });
});

describe("resolveSettings options", () => {
  it("prefers an explicit option over the environment, an explicit false included", () => {
    const settings = settingsFor(
      {
        STORYSHELF_CAPTURE_CONCURRENCY: "8",
        STORYSHELF_NAVIGATION_TIMEOUT_MS: "9000",
        STORYSHELF_BROWSER_RECYCLE_EVERY: "25",
        STORYSHELF_REUSE_PAGES: "1",
      },
      { concurrency: 2, navigationTimeoutMs: 1234, recycleBrowserEvery: 0, reusePages: false },
    );
    expect(settings).toEqual({
      concurrency: 2,
      navigationTimeoutMs: 1234,
      recycleBrowserEvery: 0,
      reusePages: false,
    });
  });
});
