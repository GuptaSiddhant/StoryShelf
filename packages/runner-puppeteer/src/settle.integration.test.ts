import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPuppeteerCaptureRunner } from "./capture-runner.ts";

/**
 * Real-browser checks of render-settled signalling (ADR 0004, decision 9) and of the Storybook 10
 * `.test()` runs (decision 10) in the Puppeteer runner, against a built fixture Storybook
 * (`FIXTURE_DIR`, default storybook-8, which has no test entries). Needs a Chrome: set
 * `PUPPETEER_EXECUTABLE_PATH` (puppeteer-core ships no browser).
 */
const FIXTURE_DIR = process.env["FIXTURE_DIR"]
  ? resolve(process.env["FIXTURE_DIR"])
  : resolve(import.meta.dirname ?? ".", "..", "..", "..", "fixtures", "storybook-8");
const STATIC_DIR = join(FIXTURE_DIR, "storybook-static");
const CHROME = process.env["PUPPETEER_EXECUTABLE_PATH"];
const viewports = [{ name: "desktop", width: 800, height: 600 }];

const runner = () =>
  createPuppeteerCaptureRunner({ concurrency: 1, ...(CHROME ? { executablePath: CHROME } : {}) });
const story = (id: string): StoryEntry => ({ id, title: id, name: id, type: "story" });
const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child() {
    return this;
  },
});

const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map(async (dir) => await rm(dir, { recursive: true, force: true })));
});

/** A one-page "Storybook" whose channel never announces anything (or that has no channel at all). */
async function silentStorybook(channel: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "storyshelf-silent-"));
  scratch.push(dir);
  await mkdir(dir, { recursive: true });
  const script = channel
    ? "<script>window.__STORYBOOK_ADDONS_CHANNEL__ = { on() {} };</script>"
    : "";
  await writeFile(
    join(dir, "iframe.html"),
    `<!doctype html><html><body>${script}<div id="storybook-root">hello</div></body></html>`,
  );
  return dir;
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "render-settled signalling (Puppeteer)",
  () => {
    it("settles on Storybook's own event and reports a throwing play function", async () => {
      const log = logger();
      const id = "components-button--flaky-tag";
      const result = await runner().render({
        buildId: "settle-pp-1",
        storybookDir: STATIC_DIR,
        stories: [story("components-button--primary"), story(id)],
        viewports,
        logger: log as never,
      });
      expect(result.failures).toEqual([]);
      expect(result.captures).toHaveLength(2);
      expect(log.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("did not signal"),
      );
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          storyId: id,
          problem: expect.stringContaining("flaky tag failure"),
        }),
        "story reported an error while rendering",
      );
    }, 120_000);

    it("falls back to the fixed wait with no channel, and after the timeout with a silent one", async () => {
      const log = logger();
      const started = performance.now();
      const none = await runner().render({
        buildId: "settle-pp-2",
        storybookDir: await silentStorybook(false),
        stories: [story("any--story")],
        viewports,
        logger: log as never,
      });
      expect(none.captures).toHaveLength(1);
      expect(performance.now() - started).toBeGreaterThanOrEqual(500);
      expect(log.warn).not.toHaveBeenCalled();

      const silentStarted = performance.now();
      const silent = await runner().render({
        buildId: "settle-pp-3",
        storybookDir: await silentStorybook(true),
        stories: [story("any--story")],
        viewports,
        logger: log as never,
      });
      expect(silent.captures).toHaveLength(1);
      expect(performance.now() - silentStarted).toBeGreaterThanOrEqual(5000);
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ storyId: "any--story" }),
        expect.stringContaining("did not signal"),
      );
    }, 90_000);
  },
);

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("Storybook tests (Puppeteer)", () => {
  it("runs the test entries of the fixture (none on Storybook 8 and 9)", async () => {
    const tests = await new StorybookAdapter().discoverTests(STATIC_DIR);
    const outcomes = await runner().runTests?.({
      buildId: "tests-pp-1",
      storybookDir: STATIC_DIR,
      tests,
      playTimeoutMs: 8000,
    });
    if (tests.length === 0) {
      expect(outcomes).toEqual([]);
      return;
    }
    const byId = new Map(outcomes?.map((o) => [o.storyId, o]));
    expect(byId.get("components-button--primary:renders-its-label")?.status).toBe("passed");
    expect(byId.get("components-button--secondary:clicks-without-error")?.status).toBe("passed");
    expect(byId.get("components-button--secondary:fails-on-purpose")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Not the label"),
    });
  }, 120_000);
});
