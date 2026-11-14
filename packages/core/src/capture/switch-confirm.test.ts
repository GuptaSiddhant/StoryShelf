import { describe, expect, it } from "vitest";
import type { RenderedSnapshot } from "../adapters/capture-runner.ts";
import { BaselineMap } from "../models/baseline-map.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { replaceStories, switchRequestOf, unconfirmedStories } from "./switch-confirm.ts";

const story = (id: string): StoryEntry => ({ id, title: "T", name: id, type: "story" });
const desktop: Viewport = { name: "desktop", width: 1280, height: 720 };
const mobile: Viewport = { name: "mobile", width: 375, height: 667 };

function baselines(rows: { storyId: string; viewportName: string; path: string }[]): BaselineMap {
  const map = new BaselineMap();
  for (const row of rows) {
    map.add({
      id: `${row.storyId}-${row.viewportName}`,
      storyId: row.storyId,
      viewportName: row.viewportName,
      browser: "chromium",
      screenshotPath: row.path,
    } as Baseline);
  }
  return map;
}

const capture = (id: string, viewportName: string, storedPath: string, switched = true) =>
  ({
    story: story(id),
    viewportName,
    screenshot: Buffer.alloc(0),
    stored: true,
    storedPath,
    ...(switched ? { switched: true } : {}),
  }) as RenderedSnapshot;

describe("switchRequestOf", () => {
  it("lists only the pairs with a baseline on the engine", () => {
    const map = baselines([{ storyId: "a", viewportName: "desktop", path: "p/a" }]);
    expect(switchRequestOf([story("a"), story("b")], [desktop, mobile], map, "chromium")).toEqual({
      baselined: [{ storyId: "a", viewportName: "desktop" }],
    });
    expect(switchRequestOf([story("a")], [desktop], map, "firefox")).toEqual({ baselined: [] });
  });
});

describe("unconfirmedStories", () => {
  const map = baselines([
    { storyId: "a", viewportName: "desktop", path: "p/same" },
    { storyId: "b", viewportName: "desktop", path: "p/old" },
  ]);

  it("keeps a switched capture only when it is the baseline's bytes", () => {
    const got = unconfirmedStories(
      [
        capture("a", "desktop", "p/same"),
        capture("b", "desktop", "p/new"),
        capture("c", "desktop", "p/c"),
        capture("d", "desktop", "p/d", false),
      ],
      map,
      "chromium",
    );
    expect([...got]).toEqual(["b", "c"]);
  });

  it("treats a capture that was not stored as unconfirmed", () => {
    const loose = {
      ...capture("a", "desktop", "p/same"),
      storedPath: undefined,
    } as RenderedSnapshot;
    expect([...unconfirmedStories([loose], map, "chromium")]).toEqual(["a"]);
  });
});

describe("replaceStories", () => {
  it("swaps every row of the listed stories, captures and failures alike", () => {
    const first = [
      capture("a", "desktop", "1"),
      capture("b", "desktop", "2"),
      capture("b", "mobile", "3"),
    ];
    const again = [capture("b", "desktop", "4", false)];
    expect(replaceStories(first, again, new Set(["b"])).map((row) => row.storedPath)).toEqual([
      "1",
      "4",
    ]);
    const failures = [
      { storyId: "a", viewportName: "desktop", error: "x" },
      { storyId: "b", viewportName: "desktop", error: "y" },
    ];
    expect(replaceStories(failures, [], new Set(["b"]))).toEqual([failures[0]]);
  });
});
