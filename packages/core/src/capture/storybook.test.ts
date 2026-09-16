import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDisabledStory, isFlakyStory } from "./adapter.ts";
import { StorybookAdapter } from "./storybook.ts";

async function withIndex(index: unknown, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "storyshelf-storybook-"));
  try {
    await writeFile(join(dir, "index.json"), JSON.stringify(index));
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("isFlakyStory", () => {
  it("detects flaky via tags case-insensitive", () => {
    expect(isFlakyStory({ tags: ["flaky-test"] })).toBe(true);
    expect(isFlakyStory({ tags: ["Flaky-Test"] })).toBe(true);
    expect(isFlakyStory({ tags: ["FLAKY-TEST"] })).toBe(true);
    expect(isFlakyStory({ tags: ["dev"] })).toBe(false);
  });

  it("detects flaky via parameters", () => {
    expect(isFlakyStory({ parameters: { flakyTest: true } })).toBe(true);
    expect(isFlakyStory({ parameters: { flakyTest: false } })).toBe(false);
    expect(isFlakyStory({ tags: ["flaky-test"], parameters: { flakyTest: false } })).toBe(true);
  });

  it("is whole-story (not per-viewport)", () => {
    // tags are story-level, so whole story is flaky
    expect(isFlakyStory({ tags: ["flaky-test"], parameters: undefined })).toBe(true);
  });
});

describe("isDisabledStory", () => {
  it("detects via parameters", () => {
    expect(isDisabledStory({ parameters: { disableSnapshot: true } })).toBe(true);
    expect(isDisabledStory({ parameters: { disableSnapshot: false } })).toBe(false);
  });

  it("detects via tags case-insensitive", () => {
    expect(isDisabledStory({ tags: ["skip"] })).toBe(true);
    expect(isDisabledStory({ tags: ["SKIP"] })).toBe(true);
    expect(isDisabledStory({ tags: ["disable"] })).toBe(true);
    expect(isDisabledStory({ tags: ["disable-snapshot"] })).toBe(true);
    expect(isDisabledStory({ tags: ["disable-Snapshot"] })).toBe(true);
    expect(isDisabledStory({ tags: ["dev"] })).toBe(false);
  });
});

describe("StorybookAdapter.discover", () => {
  it("filters docs and test subtypes", async () => {
    const adapter = new StorybookAdapter();
    const index = {
      v: 5,
      entries: {
        a: { id: "a", title: "A", name: "A", type: "story", subtype: "story", tags: [] },
        b: { id: "b", title: "B", name: "B", type: "docs", subtype: "story", tags: [] },
        c: { id: "c", title: "C", name: "C", type: "story", subtype: "test", tags: [] },
      },
    };
    await withIndex(index, async (dir) => {
      const stories = await adapter.discover(dir);
      expect(stories.map((s) => s.id)).toEqual(["a"]);
    });
  });

  it("merges chromatic and storyshelf parameters (storyshelf wins)", async () => {
    const adapter = new StorybookAdapter();
    const index = {
      v: 5,
      entries: {
        s1: {
          id: "s1",
          title: "T",
          name: "N",
          type: "story",
          subtype: "story",
          tags: [],
          parameters: {
            chromatic: { disableSnapshot: true, delay: 100 },
            storyshelf: { delay: 300 },
          },
        },
      },
    };
    await withIndex(index, async (dir) => {
      const [s] = await adapter.discover(dir);
      expect(s?.parameters).toEqual({ disableSnapshot: true, delay: 300 });
    });
  });

  it("prefers stories.json for parameters when both exist", async () => {
    const adapter = new StorybookAdapter();
    const dir = await mkdtemp(join(tmpdir(), "storyshelf-storybook-"));
    try {
      const indexJson = {
        v: 5,
        entries: {
          s1: {
            id: "s1",
            title: "T",
            name: "N",
            type: "story",
            subtype: "story",
            tags: ["flaky-test"],
          },
        },
      };
      const storiesJson = {
        v: 5,
        entries: {
          s1: {
            id: "s1",
            title: "T",
            name: "N",
            type: "story",
            subtype: "story",
            tags: ["flaky-test"],
            parameters: { storyshelf: { flakyTest: true, delay: 123 } },
          },
        },
      };
      await writeFile(join(dir, "index.json"), JSON.stringify(indexJson));
      await writeFile(join(dir, "stories.json"), JSON.stringify(storiesJson));
      const [s] = await adapter.discover(dir);
      expect(s?.parameters).toEqual({ flakyTest: true, delay: 123 });
      expect(s?.tags).toEqual(["flaky-test"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles index.json without parameters (SB8) and tags-based flaky detection", async () => {
    const adapter = new StorybookAdapter();
    const index = {
      v: 5,
      entries: {
        s1: {
          id: "s1",
          title: "T",
          name: "N",
          type: "story",
          subtype: "story",
          tags: ["flaky-test"],
        },
        s2: { id: "s2", title: "T", name: "N2", type: "story", subtype: "story", tags: ["skip"] },
      },
    };
    await withIndex(index, async (dir) => {
      const stories = await adapter.discover(dir);
      expect(isFlakyStory(stories[0] ?? {})).toBe(true);
      expect(isDisabledStory(stories[1] ?? {})).toBe(true);
    });
  });

  it("builds iframe URL correctly", () => {
    const adapter = new StorybookAdapter();
    expect(adapter.buildUrl("http://127.0.0.1:1234", "a--b")).toBe(
      "http://127.0.0.1:1234/iframe.html?id=a--b&viewMode=story",
    );
    expect(adapter.buildUrl("http://127.0.0.1:1234", "a b/c")).toBe(
      "http://127.0.0.1:1234/iframe.html?id=a%20b%2Fc&viewMode=story",
    );
  });
});
