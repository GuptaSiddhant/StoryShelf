import type { CatalogEntry } from "@storyshelf/core/capture";
import type { Snapshot } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import { entriesFromSnapshots, groupLibrary } from "./library-model.ts";

function entry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id,
    title: "Button",
    name: id,
    importPath: "src/Button.stories.tsx",
    type: "story",
    tags: [],
    ...overrides,
  };
}

describe("groupLibrary", () => {
  it("groups by title, splits stories from docs and orders titles", () => {
    const groups = groupLibrary([
      entry("z--a", { title: "Zed", importPath: "src/Z.tsx" }),
      entry("button--a"),
      entry("button--docs", { type: "docs" }),
      entry("button--b"),
    ]);
    expect(groups.map((group) => group.title)).toEqual(["Button", "Zed"]);
    expect(groups[0]?.stories.map((story) => story.id)).toEqual(["button--a", "button--b"]);
    expect(groups[0]?.docs.map((docs) => docs.id)).toEqual(["button--docs"]);
    expect(groups[0]?.importPath).toBe("src/Button.stories.tsx");
  });

  it("keeps distinct tags in first-seen order, without the ones Storybook adds itself", () => {
    const [group] = groupLibrary([
      entry("a", { tags: ["dev", "beta", "autodocs"] }),
      entry("b", { tags: ["beta", "stable", "test", "play-fn"] }),
    ]);
    expect(group?.tags).toEqual(["beta", "stable"]);
  });

  it("has no component page path for a group whose entries name no story file", () => {
    const [group] = groupLibrary([entry("a", { importPath: "" })]);
    expect(group?.importPath).toBe("");
  });
});

function snap(storyId: string, viewport: string): Snapshot {
  return {
    storyId,
    storyName: "Primary",
    storyTitle: "Button",
    storyImportPath: "./src/Button.stories.tsx",
    viewportName: viewport,
  } as Snapshot;
}

describe("entriesFromSnapshots", () => {
  it("makes one entry per story, whatever its modes", () => {
    const entries = entriesFromSnapshots([
      snap("button--primary", "desktop"),
      snap("button--primary", "mobile"),
    ]);
    expect(entries).toEqual([
      {
        id: "button--primary",
        title: "Button",
        name: "Primary",
        importPath: "src/Button.stories.tsx",
        type: "story",
        tags: [],
      },
    ]);
  });

  it("falls back to Untitled and an empty path", () => {
    const [entry0] = entriesFromSnapshots([
      { storyId: "x", storyName: "X", storyTitle: "", storyImportPath: null } as Snapshot,
    ]);
    expect(entry0).toMatchObject({ title: "Untitled", importPath: "" });
  });
});
