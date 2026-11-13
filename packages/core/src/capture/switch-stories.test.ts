import { describe, expect, it } from "vitest";
import { switchStoriesEnabled, switchStoriesVetoed } from "./switch-stories.ts";

describe("switchStoriesEnabled", () => {
  it("is off unless the project turns it on", () => {
    expect(switchStoriesEnabled({}, false)).toBe(false);
    expect(switchStoriesEnabled({ switchStories: false }, false)).toBe(false);
    expect(switchStoriesEnabled({ switchStories: true }, false)).toBe(true);
  });

  it("lets the operator veto a project that opted in", () => {
    expect(switchStoriesEnabled({ switchStories: true }, true)).toBe(false);
  });
});

describe("switchStoriesVetoed", () => {
  it("vetoes only on an explicit false", () => {
    expect(switchStoriesVetoed({})).toBe(false);
    expect(switchStoriesVetoed({ switchStories: true })).toBe(false);
    expect(switchStoriesVetoed({ switchStories: false })).toBe(true);
  });
});
