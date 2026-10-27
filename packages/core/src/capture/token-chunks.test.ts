import { describe, expect, it, vi } from "vitest";
import type { CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";
import { MIN_CAPTURES_PER_SLICE } from "../utils/storybook-token.ts";
import type { StoryEntry } from "./adapter.ts";
import type { RenderRequest } from "./render.ts";
import type { StorybookUrlSource } from "./storybook-urls.ts";
import { renderInSlices } from "./token-chunks.ts";

const env = (name: string) => ({ browserVersion: name }) as never;

const stories = (count: number): StoryEntry[] =>
  Array.from(
    { length: count },
    (_, index) => ({ id: `s${index}`, title: "T", name: `n${index}` }) as StoryEntry,
  );

function setup(ttl: number | undefined, count: number) {
  const seen: { url: string | undefined; stories: number }[] = [];
  const render = vi.fn((request: RenderRequest): Promise<RenderResult> => {
    seen.push({ url: request.storybookUrl, stories: request.stories.length });
    return Promise.resolve({ captures: [], failures: [] });
  });
  const mint = vi.fn(() => Promise.resolve(`https://x/_s/t${mint.mock.calls.length}/`));
  const source: StorybookUrlSource = mint;
  if (ttl !== undefined) {
    source.ttlSeconds = () => ttl;
  }
  const run = async () =>
    await renderInSlices({
      runner: { render, cancel: vi.fn() } as unknown as CaptureRunner,
      request: { stories: stories(count), buildId: "b" } as unknown as RenderRequest,
      browser: "chromium",
      storybookUrl: source,
      captureCount: () => 1,
      renderTimeoutMs: undefined,
    });
  return { run, seen, mint };
}

describe("renderInSlices", () => {
  it("renders a pass that fits its token in one call", async () => {
    const { run, seen, mint } = setup(86_400, 100);
    await run();
    expect(seen).toEqual([{ url: "https://x/_s/t1/", stories: 100 }]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("renders in one call when the source reports no lifetime", async () => {
    const { run, seen } = setup(undefined, 5000);
    await run();
    expect(seen).toHaveLength(1);
  });

  it("cuts a pass that outlasts its token and mints a fresh URL per slice", async () => {
    // 2 h lifetime: (7200 - 300) s / 15 s = 460 captures per slice; 1000 stories need three.
    const { run, seen, mint } = setup(7200, 1000);
    await run();
    expect(seen.map((call) => call.stories)).toEqual([460, 460, 80]);
    expect(new Set(seen.map((call) => call.url)).size).toBe(3);
    expect(mint).toHaveBeenCalledTimes(3);
  });

  it("slices legacy short lifetimes below the usual minimum", async () => {
    const { run, seen } = setup(600, 45);
    await run();
    expect(seen.map((call) => call.stories)).toEqual([20, 20, 5]);
  });

  it("caps the default 15 minute timeout for the valid 1050 second floor", async () => {
    const { run, mint } = setup(1050, 1);
    await run();
    expect(mint).toHaveBeenCalledWith("chromium", { budgetMs: 750_000 });
  });

  it("rejects a lifetime too short for a capture and grace", async () => {
    const { run, mint } = setup(60, 1);
    await expect(run()).rejects.toThrow(/increase or clear/u);
    expect(mint).not.toHaveBeenCalled();
  });

  it("rejects a story too large to fit in one slice", async () => {
    const source: StorybookUrlSource = vi.fn(() => Promise.resolve("url"));
    source.ttlSeconds = () => 600;
    await expect(
      renderInSlices({
        runner: { render: vi.fn(), cancel: vi.fn() } as unknown as CaptureRunner,
        request: { stories: stories(1), buildId: "b" } as never,
        browser: "chromium",
        storybookUrl: source,
        captureCount: () => 21,
        renderTimeoutMs: undefined,
      }),
    ).rejects.toThrow(/slice limit/u);
  });

  it("caps an explicit render timeout to the token lifetime minus grace", async () => {
    const source: StorybookUrlSource = vi.fn(() => Promise.resolve("url"));
    source.ttlSeconds = () => 600;
    await renderInSlices({
      runner: {
        render: vi.fn().mockResolvedValue({ captures: [], failures: [] }),
        cancel: vi.fn(),
      } as unknown as CaptureRunner,
      request: { stories: stories(1), buildId: "b" } as never,
      browser: "chromium",
      storybookUrl: source,
      captureCount: () => 1,
      renderTimeoutMs: 900_000,
    });
    expect(source).toHaveBeenCalledWith("chromium", { budgetMs: 300_000 });
  });

  it("keeps each slice's environment with its own captures", async () => {
    const render = vi
      .fn()
      .mockResolvedValueOnce({
        captures: [{ storyId: "a" }],
        failures: [],
        environment: env("1"),
      })
      .mockResolvedValueOnce({
        captures: [{ storyId: "b" }],
        failures: [],
        environment: env("2"),
      });
    const source: StorybookUrlSource = vi.fn(() => Promise.resolve("https://x/_s/t/"));
    source.ttlSeconds = () => 1050;
    const result = await renderInSlices({
      runner: { render, cancel: vi.fn() } as unknown as CaptureRunner,
      request: { stories: stories(MIN_CAPTURES_PER_SLICE + 1), buildId: "b" } as never,
      browser: "chromium",
      storybookUrl: source,
      captureCount: () => 1,
      renderTimeoutMs: undefined,
    });
    expect(result.captures.map((capture) => capture.environment)).toEqual([env("1"), env("2")]);
  });
});
