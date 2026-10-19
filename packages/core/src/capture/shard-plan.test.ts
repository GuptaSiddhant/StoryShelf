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

describe("planShards with timings", () => {
  it("packs the dearest stories first and hands back the heaviest shard first", () => {
    // 6 stories, one capture each, 3 shards of 2: costs 60/50/40/30/20/10.
    const cost = new Map([
      ["s0", 60],
      ["s1", 50],
      ["s2", 40],
      ["s3", 30],
      ["s4", 20],
      ["s5", 10],
    ]);
    const slices = planShards([chromium(6)], one, 2, (id) => cost.get(id));

    const weights = slices.map((slice) =>
      ids(slice).reduce((sum, id) => sum + (cost.get(id) ?? 0), 0),
    );
    // Longest-first balances the shards: 60+10, 50+20, 40+30 — not 60+50, 40+30, 20+10.
    expect(weights).toEqual([70, 70, 70]);
    expect(ids(slices[0] ?? [])).toContain("s0");
  });

  it("evens out shards a contiguous slice would leave lopsided", () => {
    const slow = new Set(["s0", "s1", "s2", "s3"]);
    const weightOf = (id: string): number => (slow.has(id) ? 100 : 10);
    const weigh = (slices: EngineWork[][]): number[] =>
      slices.map((slice) => ids(slice).reduce((sum, id) => sum + weightOf(id), 0));

    const timed = weigh(planShards([chromium(12)], one, 4, weightOf));
    // Contiguous slicing puts every slow story in the first shard, which then sets the wall clock.
    const plain = weigh(planShards([chromium(12)], one, 4));

    expect(Math.max(...plain)).toBe(400);
    expect(Math.max(...timed)).toBeLessThan(Math.max(...plain));
    // Capacity still binds: four slow stories cannot spread over three shards any more evenly.
    expect(timed).toEqual([220, 130, 130]);
  });

  it("prices an unknown story at the average cost of a capture", () => {
    const slices = planShards([chromium(6)], one, 2, (id) => (id === "s0" ? 100 : undefined));

    // s0 is dearest; the untimed five are all worth the same, so they fill the rest evenly.
    expect(ids(slices[0] ?? [])).toContain("s0");
    expect(slices.flatMap((slice) => ids(slice))).toHaveLength(6);
  });

  it("falls back to capture-count slices when no story has a timing", () => {
    const none = new Map<string, number>();
    const slices = planShards([chromium(25)], one, 10, (id) => none.get(id));

    expect(slices.map((slice) => ids(slice).length)).toEqual([10, 10, 5]);
    expect(slices.flatMap((slice) => ids(slice))).toEqual(stories(25).map((entry) => entry.id));
  });

  it("keeps a story's engines together when packing by weight", () => {
    const work: EngineWork[] = [
      { browser: "chromium", stories: stories(15) },
      { browser: "firefox", stories: stories(15) },
    ];
    const slices = planShards(work, one, 10, (id) => (id === "s7" ? 500 : 5));

    for (const slice of slices) {
      const perEngine = slice.map((engine) => engine.stories.map((entry) => entry.id));
      for (const engineIds of perEngine) {
        expect(engineIds).toEqual(perEngine[0]);
      }
    }
    expect(new Set(slices.flatMap((slice) => ids(slice))).size).toBe(15);
  });

  it("never packs a shard past its capture capacity", () => {
    const slices = planShards([chromium(30)], one, 10, (id) => Number(id.slice(1)) * 7);

    for (const slice of slices) {
      expect(ids(slice).length).toBeLessThanOrEqual(10);
    }
    expect(slices.flatMap((slice) => ids(slice))).toHaveLength(30);
  });
});

describe("totalCaptures", () => {
  it("sums story x engine captures", () => {
    expect(totalCaptures([chromium(4), { browser: "firefox", stories: stories(2) }], () => 3)).toBe(
      18,
    );
  });
});
