import { describe, expect, it } from "vitest";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { DEFAULT_VIEWPORTS } from "./adapter.ts";
import { STORYBOOK_BUILTIN_VIEWPORTS, resolveStoryViewports } from "./storybook.ts";

const GLOBAL: Viewport[] = [{ name: "desktop", width: 1280, height: 720 }];

function storyOf(parameters?: StoryEntry["parameters"]): StoryEntry {
  return { id: "a", title: "T", name: "A", type: "story", parameters };
}

describe("DEFAULT_VIEWPORTS", () => {
  it("captures a single desktop viewport", () => {
    expect(DEFAULT_VIEWPORTS).toEqual([{ name: "desktop", width: 1280, height: 720 }]);
  });
});

describe("STORYBOOK_BUILTIN_VIEWPORTS", () => {
  it("snapshots the documented MINIMAL_VIEWPORTS set", () => {
    expect(STORYBOOK_BUILTIN_VIEWPORTS).toEqual({
      mobile1: { name: "mobile1", width: 320, height: 568 },
      mobile2: { name: "mobile2", width: 414, height: 896 },
      tablet: { name: "tablet", width: 834, height: 1112 },
      desktop: { name: "desktop", width: 1024, height: 1280 },
    });
  });
});

describe("resolveStoryViewports", () => {
  it("returns the global list for a story without viewport config", () => {
    expect(resolveStoryViewports(storyOf(), GLOBAL)).toEqual(GLOBAL);
    expect(
      resolveStoryViewports(storyOf({ viewport: { defaultViewport: undefined } }), GLOBAL),
    ).toEqual(GLOBAL);
  });

  it("appends the story's builtin default viewport (union)", () => {
    expect(
      resolveStoryViewports(storyOf({ viewport: { defaultViewport: "tablet" } }), GLOBAL),
    ).toEqual([...GLOBAL, { name: "tablet", width: 834, height: 1112 }]);
  });

  it("dedupes when the story default matches a global viewport name", () => {
    expect(
      resolveStoryViewports(storyOf({ viewport: { defaultViewport: "desktop" } }), GLOBAL),
    ).toEqual(GLOBAL);
  });

  it("ignores unresolvable default viewport names", () => {
    expect(
      resolveStoryViewports(storyOf({ viewport: { defaultViewport: "galaxy" } }), GLOBAL),
    ).toEqual(GLOBAL);
  });

  it("lets inline custom viewports win over the builtin dimensions", () => {
    const story = storyOf({
      viewport: {
        defaultViewport: "tablet",
        viewports: {
          tablet: { name: "tablet", styles: { width: 900, height: 800 } },
        },
      },
    });
    expect(resolveStoryViewports(story, GLOBAL)).toEqual([
      ...GLOBAL,
      { name: "tablet", width: 900, height: 800 },
    ]);
  });

  it("parses string pixel styles for inline viewports", () => {
    const story = storyOf({
      viewport: {
        defaultViewport: "narrow",
        viewports: {
          narrow: { name: "narrow", styles: { width: "320px", height: "568px" } },
        },
      },
    });
    expect(resolveStoryViewports(story, GLOBAL)).toEqual([
      ...GLOBAL,
      { name: "narrow", width: 320, height: 568 },
    ]);
  });

  it("skips inline viewports without parseable dimensions", () => {
    const story = storyOf({
      viewport: {
        defaultViewport: "tiny",
        viewports: { tiny: { name: "tiny" } },
      },
    });
    expect(resolveStoryViewports(story, GLOBAL)).toEqual(GLOBAL);
  });

  it("reuses the inline display name when it differs from the default key", () => {
    const story = storyOf({
      viewport: {
        defaultViewport: "mobile1",
        viewports: {
          mobile1: { name: "Phone", styles: { width: 320, height: 568 } },
        },
      },
    });
    expect(resolveStoryViewports(story, GLOBAL)).toEqual([
      ...GLOBAL,
      { name: "Phone", width: 320, height: 568 },
    ]);
  });
});
