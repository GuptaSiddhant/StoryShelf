import { describe, expect, it } from "vitest";
import { diffEntries, groupComponents, hashEntries, toBuildComponent } from "./components.ts";
import type { CatalogEntry } from "./types.ts";

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

describe("groupComponents", () => {
  it("groups entries by story file, counts stories but not docs, and orders by title", () => {
    const groups = groupComponents([
      entry("z--one", { title: "Zed", importPath: "src/Z.stories.tsx" }),
      entry("button--a"),
      entry("button--b"),
      entry("button--docs", { type: "docs" }),
    ]);
    expect(groups.map((group) => [group.title, group.storyCount, group.entries.length])).toEqual([
      ["Button", 2, 3],
      ["Zed", 1, 1],
    ]);
  });

  it("keys entries without a story file by title", () => {
    const groups = groupComponents([
      entry("a--x", { title: "A", importPath: "" }),
      entry("b--x", { title: "B", importPath: "" }),
      entry("a--y", { title: "A", importPath: "" }),
    ]);
    expect(groups.map((group) => [group.title, group.importPath, group.storyCount])).toEqual([
      ["A", "", 2],
      ["B", "", 1],
    ]);
  });

  it("maps a component to the row fields build_components stores", () => {
    const [group] = groupComponents([entry("button--a")]);
    expect(toBuildComponent(group!)).toEqual({
      importPath: "src/Button.stories.tsx",
      title: "Button",
      storyCount: 1,
      hash: group!.hash,
    });
  });
});

describe("hashEntries", () => {
  it("is stable under reordering and changes with any entry's id, name, type or title", () => {
    const a = entry("a");
    const b = entry("b");
    expect(hashEntries([a, b])).toBe(hashEntries([b, a]));
    expect(hashEntries([a, b])).toMatch(/^[0-9a-f]{64}$/u);
    for (const changed of [
      entry("a", { name: "Renamed" }),
      entry("a", { type: "docs" }),
      entry("a", { title: "Other" }),
      entry("c"),
    ]) {
      expect(hashEntries([changed, b])).not.toBe(hashEntries([a, b]));
    }
  });

  it("ignores tags and the story file path, which are not the component's stories", () => {
    expect(hashEntries([entry("a", { tags: ["x"], importPath: "elsewhere.tsx" })])).toBe(
      hashEntries([entry("a")]),
    );
  });
});

describe("diffEntries", () => {
  it("counts added, removed and renamed entries by id", () => {
    const before = [entry("a"), entry("b"), entry("c")];
    const after = [entry("a"), entry("b", { name: "B2" }), entry("d")];
    expect(diffEntries(before, after)).toEqual({ added: 1, removed: 1, renamed: 1 });
  });

  it("reports nothing for equal sets", () => {
    expect(diffEntries([entry("a")], [entry("a")])).toEqual({ added: 0, removed: 0, renamed: 0 });
  });
});
