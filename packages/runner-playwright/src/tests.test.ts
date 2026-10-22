import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inPageWaitSettled, type SettleReport } from "./settle.ts";
import { DEFAULT_TEST_TIMEOUT_MS, runTestEntries, verdictOf } from "./tests.ts";
import type { ActiveRun, TargetDriver } from "./types.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "storyshelf-run-tests-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const settled: SettleReport = { settled: true, hooked: true, phase: "completed", elapsedMs: 5 };

function entry(slug: string): StoryEntry {
  return {
    id: `s--a:${slug}`,
    title: "S",
    name: slug,
    type: "story",
    parentId: "s--a",
  };
}

/** A browser whose pages answer the settle wait with `reports[slug]` for the test they opened. */
function harness(reports: Record<string, SettleReport | Error>) {
  const urls: string[] = [];
  const timeouts: number[] = [];
  const closed = { pages: 0, browser: 0 };
  const newPage = async () => {
    let current = "";
    return {
      addInitScript: async (): Promise<void> => {},
      setDefaultTimeout: (ms: number): void => {
        timeouts.push(ms);
      },
      setViewportSize: async (): Promise<void> => {},
      goto: async (url: string): Promise<void> => {
        urls.push(url);
        current = decodeURIComponent(url).split("id=")[1]?.split("&")[0]?.split(":")[1] ?? "";
      },
      evaluate: async (fn: unknown, arg: { timeoutMs: number }): Promise<unknown> => {
        if (fn !== inPageWaitSettled) return undefined;
        timeouts.push(arg.timeoutMs);
        const report = reports[current];
        if (report instanceof Error) throw report;
        return report;
      },
      close: async (): Promise<void> => {
        closed.pages += 1;
      },
    };
  };
  const browser = {
    newPage,
    close: async (): Promise<void> => {
      closed.browser += 1;
    },
  };
  const driver: TargetDriver = {
    launch: async () => browser as never,
    remote: (): undefined => {},
  };
  return { driver, urls, timeouts, closed };
}

const active = (): ActiveRun => ({ cancelled: false, browser: null });

describe("runTestEntries", () => {
  it("opens each test's iframe URL and reports pass or fail from what Storybook announced", async () => {
    const { driver, urls, closed } = harness({
      ok: settled,
      bad: { ...settled, playError: "expected 1 to be 2", phase: "errored" },
    });
    const outcomes = await runTestEntries(
      { buildId: "b", storybookDir: dir, tests: [entry("ok"), entry("bad")], concurrency: 2 },
      active(),
      driver,
      "chromium",
    );
    expect(outcomes.map((o) => [o.storyId, o.status, o.error])).toEqual([
      ["s--a:ok", "passed", undefined],
      ["s--a:bad", "failed", "expected 1 to be 2"],
    ]);
    expect(urls.map((u) => u.replace(/^http:\/\/127\.0\.0\.1:\d+/u, ""))).toEqual([
      "/iframe.html?id=s--a%3Aok&viewMode=story",
      "/iframe.html?id=s--a%3Abad&viewMode=story",
    ]);
    expect(closed).toEqual({ pages: 2, browser: 1 });
  });

  it("uses the project's play timeout, else the default", async () => {
    const withTimeout = harness({ ok: settled });
    await runTestEntries(
      {
        buildId: "b",
        storybookDir: dir,
        tests: [entry("ok")],
        playTimeoutMs: 1234,
        concurrency: 1,
      },
      active(),
      withTimeout.driver,
      "chromium",
    );
    expect(withTimeout.timeouts).toEqual([1234]);
    const withDefault = harness({ ok: settled });
    await runTestEntries(
      { buildId: "b", storybookDir: dir, tests: [entry("ok")], concurrency: 1 },
      active(),
      withDefault.driver,
      "chromium",
    );
    expect(withDefault.timeouts).toEqual([DEFAULT_TEST_TIMEOUT_MS]);
  });

  it("fails a test whose page could not be driven, without failing the others", async () => {
    const { driver } = harness({ boom: new Error("page crashed"), ok: settled });
    const outcomes = await runTestEntries(
      { buildId: "b", storybookDir: dir, tests: [entry("boom"), entry("ok")], concurrency: 1 },
      active(),
      driver,
      "chromium",
    );
    // waitForSettled turns a throwing evaluate into "no signal", so it reads as a dead preview.
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "passed"]);
    expect(outcomes[0]?.error).toMatch(/did not start/u);
  });

  it("fails a test whose navigation threw, and says it timed out when it did", async () => {
    const page = {
      addInitScript: async (): Promise<void> => {},
      setDefaultTimeout: (): void => {},
      setViewportSize: async (): Promise<void> => {},
      goto: async (): Promise<void> => {
        throw new Error("page.goto: Timeout 30000ms exceeded.");
      },
      close: async (): Promise<void> => {},
    };
    const browser = { newPage: async () => page, close: async (): Promise<void> => {} };
    const driver: TargetDriver = {
      launch: async () => browser as never,
      remote: (): undefined => {},
    };
    const outcomes = await runTestEntries(
      {
        buildId: "b",
        storybookDir: dir,
        tests: [entry("slow")],
        concurrency: 1,
        navigationTimeoutMs: 30_000,
      },
      active(),
      driver,
      "chromium",
    );
    expect(outcomes[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Timeout"),
    });
  });

  it("stops when the run was cancelled", async () => {
    const { driver, closed } = harness({ ok: settled });
    const run = active();
    run.cancelled = true;
    await expect(
      runTestEntries(
        { buildId: "b", storybookDir: dir, tests: [entry("ok")], concurrency: 1 },
        run,
        driver,
        "chromium",
      ),
    ).rejects.toThrow("Capture cancelled");
    expect(closed.browser).toBe(1);
  });

  it("answers an empty list with no outcomes", async () => {
    const { driver } = harness({});
    const launch = vi.spyOn(driver, "launch");
    expect(
      await runTestEntries(
        { buildId: "b", storybookDir: dir, tests: [] },
        active(),
        driver,
        "chromium",
      ),
    ).toEqual([]);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("verdictOf", () => {
  it("passes a settled, clean run", () => {
    expect(verdictOf("t", settled, 1000, 7)).toEqual({
      storyId: "t",
      status: "passed",
      durationMs: 7,
    });
  });

  it("fails on a render error, a play error, then unhandled errors, in that order", () => {
    const base = { ...settled, renderError: "r", playError: "p", unhandled: ["u"] };
    expect(verdictOf("t", base, 1, 1).error).toBe("render failed: r");
    expect(verdictOf("t", { ...base, renderError: undefined }, 1, 1).error).toBe("p");
    expect(
      verdictOf("t", { ...base, renderError: undefined, playError: undefined }, 1, 1).error,
    ).toBe("u");
  });

  it("fails a run that never finished, naming the phase, and flags it as timed out", () => {
    const outcome = verdictOf(
      "t",
      { settled: false, hooked: true, phase: "playing", elapsedMs: 9 },
      50,
      9,
    );
    expect(outcome).toMatchObject({ status: "failed", timedOut: true });
    expect(outcome.error).toBe("test did not finish within 50ms (phase: playing)");
  });

  it("fails a page without a Storybook preview", () => {
    expect(
      verdictOf("t", { settled: false, hooked: false, phase: null, elapsedMs: 0 }, 1, 1).error,
    ).toMatch(/did not start/u);
  });
});
