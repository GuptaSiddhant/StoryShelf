import { describe, expect, it, vi } from "vitest";
import { switchStoriesEnabled, switchStoriesFor, switchStoriesVetoed } from "./switch-stories.ts";

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

describe("switchStoriesFor", () => {
  const offering = { metadata: { switchStories: true } };

  it("switches only when the project asks, nobody vetoes and the runner offers it", () => {
    expect(switchStoriesFor({ switchStories: true }, { vetoed: false, runner: offering })).toBe(
      true,
    );
    expect(switchStoriesFor({}, { vetoed: false, runner: offering })).toBe(false);
  });

  it("logs once why a project that asked is refused", () => {
    const log = vi.fn();
    expect(switchStoriesFor({ switchStories: true }, { vetoed: true, runner: offering, log })).toBe(
      false,
    );
    expect(
      switchStoriesFor({ switchStories: true }, { vetoed: false, runner: { metadata: {} }, log }),
    ).toBe(false);
    expect(log.mock.calls.map((call) => (call[1] as { reason: string }).reason)).toEqual([
      "vetoed",
      "runner",
    ]);
    switchStoriesFor({}, { vetoed: true, runner: offering, log });
    expect(log).toHaveBeenCalledTimes(2);
  });
});
