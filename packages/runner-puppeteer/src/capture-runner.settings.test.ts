import { afterEach, describe, expect, it, vi } from "vitest";

const renderAllMock = vi.hoisted(() => vi.fn(async (_input: unknown) => await Promise.resolve([])));
vi.mock("./pipeline.ts", () => ({ renderAll: renderAllMock }));

import { createPuppeteerCaptureRunner } from "./capture-runner.ts";

/** The settings the runner hands the pipeline for one render with the given environment. */
async function settingsFor(
  env: Record<string, string>,
  options: Parameters<typeof createPuppeteerCaptureRunner>[0] = {},
): Promise<Record<string, unknown>> {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  renderAllMock.mockClear();
  await createPuppeteerCaptureRunner(options).render({ buildId: "b", runId: "r" } as never);
  return renderAllMock.mock.calls[0]?.[0] as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runner settings from the environment", () => {
  it.each([
    ["8", 8],
    [" 8", 8],
    ["+8", 8],
    ["12abc", 12],
    ["0", undefined],
    ["", undefined],
    ["abc", undefined],
    ["-3", undefined],
  ])("reads STORYSHELF_CAPTURE_CONCURRENCY=%j as %j", async (raw, expected) => {
    const settings = await settingsFor({ STORYSHELF_CAPTURE_CONCURRENCY: raw });
    expect(settings["concurrency"]).toBe(expected);
  });

  it.each([
    ["0", 0],
    ["25", 25],
    ["", undefined],
    ["x", undefined],
  ])("reads STORYSHELF_BROWSER_RECYCLE_EVERY=%j as %j", async (raw, expected) => {
    const settings = await settingsFor({ STORYSHELF_BROWSER_RECYCLE_EVERY: raw });
    expect(settings["recycleBrowserEvery"]).toBe(expected);
  });

  it("prefers an explicit option over the environment", async () => {
    const settings = await settingsFor(
      { STORYSHELF_CAPTURE_CONCURRENCY: "8", STORYSHELF_NAVIGATION_TIMEOUT_MS: "9000" },
      { concurrency: 2, navigationTimeoutMs: 1234 },
    );
    expect(settings).toMatchObject({ concurrency: 2, navigationTimeoutMs: 1234 });
  });

  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["", false],
  ])("reads STORYSHELF_REUSE_PAGES=%j as %j", async (raw, expected) => {
    const settings = await settingsFor({ STORYSHELF_REUSE_PAGES: raw });
    expect(settings["reusePages"]).toBe(expected);
  });
});
