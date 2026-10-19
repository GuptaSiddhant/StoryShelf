import { describe, expect, it } from "vitest";
import type { StoryEntry } from "./adapter.ts";
import { planShards, totalCaptures, type EngineWork } from "./shard-plan.ts";

const story = (id: string): StoryEntry => ({ id, title: "T", name: id, type: "story" });
const stories = (count: number, prefix = "s"): StoryEntry[] =>
  Array.from({ length: count }, (_unused, index) => story(`${prefix}${index}`));
const one = (): number => 1;
const heavyFirst = (entry: StoryEntry): number => (entry.id === "s0" ? 30 : 1);
const chromium = (count: number): EngineWork => ({ browser: "chromium", stories: stories(count) });
const ids = (slice: EngineWork[]): string[] =>
  slice.flatMap((engine) => engine.stories.map((entry) => entry.id));

describe("planShards", () => {
  it("does not shard when sharding is off", () => {
    expect(planShards([chromium(500)], one, Number.NaN)).toEqual([]);
    expect(planShards([chromium(500)], one, 0)).toEqual([]);
  });

  it("keeps a small build as one shard (up to twice the size)", () => {
    expect(planShards([chromium(20)], one, 10)).toEqual([]);
    expect(planShards([chromium(21)], one, 10)).toHaveLength(3);
  });

  it("slices contiguous runs of about the target size, in story order", () => {
    const slices = planShards([chromium(25)], one, 10);
    expect(slices.map((slice) => ids(slice).length)).toEqual([10, 10, 5]);
    expect(slices.flatMap((slice) => ids(slice))).toEqual(stories(25).map((entry) => entry.id));
  });

  it("counts a story's viewports towards its cost", () => {
    const slices = planShards([chromium(12)], heavyFirst, 10);
    expect(ids(slices[0] ?? [])).toEqual(["s0"]); // oversized story stands alone
    expect(slices.flatMap((slice) => ids(slice))).toHaveLength(12);
  });

  it("keeps a story's engines together and primary first", () => {
    const work: EngineWork[] = [
      { browser: "chromium", stories: stories(15) },
      { browser: "firefox", stories: stories(15) },
    ];
    const slices = planShards(work, one, 10);
    expect(slices.length).toBeGreaterThan(1);
    for (const slice of slices) {
      expect(slice.map((engine) => engine.browser)).toEqual(["chromium", "firefox"]);
      expect(ids([slice[0] as EngineWork])).toEqual(ids([slice[1] as EngineWork]));
    }
  });

  it("gives each engine only the stories it renders (affected capture can differ per engine)", () => {
    const work: EngineWork[] = [
      { browser: "chromium", stories: stories(30) },
      { browser: "firefox", stories: stories(3) },
    ];
    const slices = planShards(work, one, 10);
    const firefox = slices.flatMap((slice) =>
      slice.filter((engine) => engine.browser === "firefox"),
    );
    expect(firefox.flatMap((engine) => engine.stories.map((entry) => entry.id))).toEqual([
      "s0",
      "s1",
      "s2",
    ]);
    // Later slices have no firefox work at all, so the engine is dropped rather than left empty.
    expect(slices.at(-1)?.map((engine) => engine.browser)).toEqual(["chromium"]);
  });

  it("covers every story exactly once per engine", () => {
    const work: EngineWork[] = [
      { browser: "chromium", stories: stories(47) },
      { browser: "webkit", stories: stories(47) },
    ];
    const slices = planShards(work, one, 9);
    for (const browser of ["chromium", "webkit"]) {
      const seen = slices.flatMap((slice) =>
        slice
          .filter((engine) => engine.browser === browser)
          .flatMap((engine) => engine.stories.map((entry) => entry.id)),
      );
      expect(seen).toEqual(stories(47).map((entry) => entry.id));
    }
  });

  it("handles no work", () => {
    expect(planShards([], one, 5)).toEqual([]);
    expect(planShards([{ browser: "chromium", stories: [] }], one, 5)).toEqual([]);
  });
});

describe("totalCaptures", () => {
  it("sums story x engine captures", () => {
    expect(totalCaptures([chromium(4), { browser: "firefox", stories: stories(2) }], () => 3)).toBe(
      18,
    );
  });
});
