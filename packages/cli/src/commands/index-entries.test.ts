import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEntries, readEntryIds } from "./index-entries.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-index-"));
  mkdirSync(join(dir, "out"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readEntries", () => {
  it("keeps each story's import path and drops test entries", () => {
    const entries = {
      "a--one": { id: "a--one", title: "A", importPath: "./src/a.stories.tsx" },
      "a--two": { id: "a--two", title: "A", importPath: "./src/a.stories.tsx" },
      "a--t": { id: "a--t", title: "A", subtype: "test" },
      "b--no-path": { id: "b--no-path", title: "B" },
    };
    writeFileSync(join(dir, "out", "index.json"), JSON.stringify({ v: 5, entries }));
    expect(readEntries(dir, "out")).toEqual([
      { id: "a--one", importPath: "./src/a.stories.tsx" },
      { id: "a--two", importPath: "./src/a.stories.tsx" },
      { id: "b--no-path" },
    ]);
    expect(readEntryIds(dir, "out")).toEqual(["a--one", "a--two", "b--no-path"]);
  });

  it("is null when no index parses", () => {
    expect(readEntries(dir, "out")).toBeNull();
  });
});
