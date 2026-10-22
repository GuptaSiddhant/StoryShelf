import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStorybookIndex, parseStorybookIndexText } from "./parse.ts";

const FIXTURES = resolve(import.meta.dirname, "../../../../../fixtures");

describe("parseStorybookIndex", () => {
  it("reads v5 entries: stories and docs, tags, normalized import paths", () => {
    const entries = parseStorybookIndex({
      v: 5,
      entries: {
        "a--primary": {
          type: "story",
          id: "a--primary",
          name: "Primary",
          title: "A",
          importPath: "./src/A.stories.tsx",
          tags: ["dev", "test"],
        },
        "a--docs": {
          type: "docs",
          id: "a--docs",
          name: "Docs",
          title: "A",
          importPath: "./src/A.stories.tsx",
        },
      },
    });
    expect(entries).toEqual([
      {
        id: "a--primary",
        title: "A",
        name: "Primary",
        importPath: "src/A.stories.tsx",
        type: "story",
        tags: ["dev", "test"],
      },
      {
        id: "a--docs",
        title: "A",
        name: "Docs",
        importPath: "src/A.stories.tsx",
        type: "docs",
        tags: [],
      },
    ]);
  });

  it("reads the older stories.json shape (kind and story instead of title and name)", () => {
    const entries = parseStorybookIndex({
      v: 3,
      stories: { "b--one": { id: "b--one", kind: "B", story: "One" } },
    });
    expect(entries).toEqual([
      { id: "b--one", title: "B", name: "One", importPath: "", type: "story", tags: [] },
    ]);
  });

  it("leaves out test entries and entries without an id or a title, never throwing", () => {
    const entries = parseStorybookIndex({
      entries: {
        ok: { id: "ok", title: "T", name: "Ok", type: "story", subtype: "story" },
        test: { id: "t", title: "T", name: "Test", type: "story", subtype: "test" },
        noTitle: { id: "x" },
        noId: { title: "T" },
        junk: 4,
        nested: null,
      },
    });
    expect(entries?.map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("falls back to the id for a missing name and drops non-string tags", () => {
    const [entry] =
      parseStorybookIndex({
        entries: { s: { id: "s", title: "T", tags: ["a", 1, null] } },
      }) ?? [];
    expect(entry).toMatchObject({ name: "s", tags: ["a"] });
  });

  it("returns null for documents that are not an index", () => {
    expect(parseStorybookIndex(null)).toBeNull();
    expect(parseStorybookIndex("text")).toBeNull();
    expect(parseStorybookIndex({ entries: [] })).toBeNull();
    expect(parseStorybookIndex({ v: 5 })).toBeNull();
  });
});

describe("parseStorybookIndexText", () => {
  it("parses JSON text and yields null for text that is not JSON", () => {
    expect(parseStorybookIndexText('{"entries":{}}')).toEqual([]);
    expect(parseStorybookIndexText("<html>")).toBeNull();
  });
});

describe("the fixture Storybooks (8, 9, 10)", () => {
  for (const version of ["8", "9", "10"]) {
    const file = resolve(FIXTURES, `storybook-${version}`, "storybook-static", "index.json");
    it.skipIf(!existsSync(file))(`catalogues storybook-${version}'s index.json`, () => {
      const entries = parseStorybookIndexText(readFileSync(file, "utf8"));
      expect(entries).not.toBeNull();
      expect(entries?.length).toBeGreaterThan(0);
      expect(entries?.every((entry) => entry.id && entry.title && entry.importPath)).toBe(true);
    });
  }
});
