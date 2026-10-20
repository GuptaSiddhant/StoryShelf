import { describe, expect, it } from "vitest";
import type { RenderedSnapshot } from "../adapters/capture-runner.ts";
import type { StoryEntry } from "./adapter.ts";
import { renderIsolating, type PassOutcome } from "./isolate.ts";

function stories(count: number): StoryEntry[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `s-${String(index).padStart(2, "0")}`,
    name: `Story ${index}`,
    title: "Components/Button",
    importPath: "./B.stories.tsx",
    type: "story" as const,
  }));
}

function capture(story: StoryEntry): RenderedSnapshot {
  return { story, viewportName: "desktop", screenshot: Buffer.from(story.id) };
}

/**
 * A runner that dies when it reaches one of `poison`, after capturing the stories before it — the
 * shape of a real browser crash, where screenshots stream out as they are taken.
 */
function crashingPass(poison: Set<string>, log: string[][]) {
  return async (slice: StoryEntry[]): Promise<PassOutcome> => {
    await Promise.resolve();
    log.push(slice.map((story) => story.id));
    const captures: RenderedSnapshot[] = [];
    for (const story of slice) {
      if (poison.has(story.id)) {
        return { captures, failures: [], error: new Error(`crashed on ${story.id}`) };
      }
      captures.push(capture(story));
    }
    return { captures, failures: [] };
  };
}

/** A capture of one story at a named viewport. */
function at(story: StoryEntry, viewportName: string): RenderedSnapshot {
  return { story, viewportName, screenshot: Buffer.from(`${story.id}@${viewportName}`) };
}

/** A pass that reports one story as failed (not crashed) and captures the rest. */
async function reportingPass(slice: StoryEntry[]): Promise<PassOutcome> {
  await Promise.resolve();
  return {
    captures: slice.filter((story) => story.id !== "s-01").map((story) => capture(story)),
    failures: [{ storyId: "s-01", viewportName: "desktop", error: "render failed" }],
  };
}

/** A pass that captures everything and only then dies, as a browser can on teardown. */
async function teardownCrashPass(slice: StoryEntry[]): Promise<PassOutcome> {
  await Promise.resolve();
  return {
    captures: slice.map((story) => capture(story)),
    failures: [],
    error: new Error("crashed on teardown"),
  };
}

describe("renderIsolating", () => {
  it("renders a healthy slice in a single pass", async () => {
    const log: string[][] = [];
    const result = await renderIsolating(stories(8), crashingPass(new Set(), log));

    expect(log).toHaveLength(1);
    expect(result.captures).toHaveLength(8);
    expect(result.failures).toEqual([]);
    expect(result.poisoned).toEqual([]);
    expect(result.renderCount).toBe(8);
  });

  it("narrows a crash down to the one story at fault and captures the rest", async () => {
    const log: string[][] = [];
    const result = await renderIsolating(stories(8), crashingPass(new Set(["s-03"]), log));

    expect(result.poisoned).toEqual(["s-03"]);
    expect(new Set(result.captures.map((row) => row.story.id))).toEqual(
      new Set(["s-00", "s-01", "s-02", "s-04", "s-05", "s-06", "s-07"]),
    );
    expect(result.failures).toEqual([
      { storyId: "s-03", viewportName: "*", error: "browser crashed: crashed on s-03" },
    ]);
    // Halving, not one browser per story.
    expect(log.length).toBeLessThan(8);
  });

  it("isolates a crash on the very first story, which renders nothing to start with", async () => {
    const log: string[][] = [];
    const result = await renderIsolating(stories(8), crashingPass(new Set(["s-00"]), log));

    expect(result.poisoned).toEqual(["s-00"]);
    expect(result.captures).toHaveLength(7);
  });

  it("isolates several bad stories in the same slice", async () => {
    const log: string[][] = [];
    const result = await renderIsolating(stories(8), crashingPass(new Set(["s-02", "s-05"]), log));

    expect(new Set(result.poisoned)).toEqual(new Set(["s-02", "s-05"]));
    expect(result.captures).toHaveLength(6);
  });

  it("rethrows when no pass ever produces a screenshot", async () => {
    const log: string[][] = [];
    const dead = async (slice: StoryEntry[]): Promise<PassOutcome> => {
      await Promise.resolve();
      log.push(slice.map((story) => story.id));
      return { captures: [], failures: [], error: new Error("browser will not start") };
    };

    await expect(renderIsolating(stories(8), dead)).rejects.toThrow("browser will not start");
    // Gives up quickly instead of halving all the way down.
    expect(log.length).toBeLessThanOrEqual(6);
  });

  it("keeps per-story failures a pass reported and does not blame them for a crash", async () => {
    const result = await renderIsolating(stories(4), reportingPass);

    expect(result.poisoned).toEqual([]);
    expect(result.failures).toEqual([
      { storyId: "s-01", viewportName: "desktop", error: "render failed" },
    ]);
  });

  it("blames nobody when the crash came after every story was captured", async () => {
    const result = await renderIsolating(stories(4), teardownCrashPass);

    expect(result.poisoned).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.captures).toHaveLength(4);
  });

  it("reports what it did through the note callback", async () => {
    const events: string[] = [];
    const result = await renderIsolating(stories(8), crashingPass(new Set(["s-04"]), []), {
      note: (event) => events.push(event),
    });

    expect(result.poisoned).toEqual(["s-04"]);
    expect(events).toContain("isolating");
    expect(events).toContain("poisoned");
  });

  it("does not render anything for an empty slice", async () => {
    const log: string[][] = [];
    const result = await renderIsolating([], crashingPass(new Set(), log));

    expect(log).toEqual([]);
    expect(result).toMatchObject({ captures: [], failures: [], renderCount: 0 });
  });

  it("renders a story again when a crash cut off its later viewports, and blames it alone", async () => {
    const [a, b] = stories(2) as [StoryEntry, StoryEntry];
    const tried: string[][] = [];
    // A is captured at v1, then takes the browser down at v2; B renders fine on its own.
    const pass = async (slice: StoryEntry[]): Promise<PassOutcome> => {
      await Promise.resolve();
      tried.push(slice.map((story) => story.id));
      if (slice.includes(a)) {
        return { captures: [at(a, "v1")], failures: [], error: new Error("boom on A@v2") };
      }
      return {
        captures: slice.flatMap((story) => [at(story, "v1"), at(story, "v2")]),
        failures: [],
      };
    };

    const result = await renderIsolating([a, b], pass, { viewportsOf: () => ["v1", "v2"] });

    expect(tried).toEqual([[a.id, b.id], [a.id], [b.id]]);
    expect(result.poisoned).toEqual([a.id]);
    expect(result.failures.map((failure) => failure.storyId)).toEqual([a.id]);
    // B is rendered and kept at both viewports; A's v1, taken twice, is kept once.
    const kept = result.captures.map((c) => `${c.story.id}@${c.viewportName}`);
    expect(kept).toHaveLength(3);
    expect(new Set(kept)).toEqual(new Set([`${a.id}@v1`, `${b.id}@v1`, `${b.id}@v2`]));
  });

  it("gives the one story a crash left unrendered a pass of its own instead of blaming it", async () => {
    const tried: string[][] = [];
    let crashed = false;
    // The browser dies once, after the first story; the story left over is healthy.
    const pass = async (slice: StoryEntry[]): Promise<PassOutcome> => {
      await Promise.resolve();
      tried.push(slice.map((story) => story.id));
      if (!crashed) {
        crashed = true;
        return {
          captures: [capture(slice[0] as StoryEntry)],
          failures: [],
          error: new Error("oom"),
        };
      }
      return { captures: slice.map((story) => capture(story)), failures: [] };
    };

    const result = await renderIsolating(stories(2), pass);

    expect(tried).toEqual([["s-00", "s-01"], ["s-01"]]);
    expect(result.poisoned).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.captures).toHaveLength(2);
  });
});
