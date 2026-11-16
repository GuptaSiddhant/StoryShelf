import { describe, expect, it } from "vitest";
import { parseStoryStatus } from "./parse.ts";

const good = {
  build: { status: "reviewing", reviewPath: "/projects/gate/builds/b1/diff" },
  stories: { "a--one": { status: "changed" }, "a--two": { status: "approved", design: "stale" } },
};

describe("parseStoryStatus", () => {
  it("returns a well-formed body", () => {
    expect(parseStoryStatus(good)).toEqual(good);
  });

  it("drops fields the contract does not name", () => {
    const parsed = parseStoryStatus({ ...good, extra: 1, stories: { a: { status: "new", x: 1 } } });
    expect(parsed?.stories).toEqual({ a: { status: "new" } });
  });

  it.each([
    ["not an object", "x"],
    ["null", null],
    ["no build", { stories: {} }],
    ["no stories", { build: good.build }],
    ["an unknown build status", { ...good, build: { ...good.build, status: "weird" } }],
    ["a non-string path", { ...good, build: { status: "reviewing", reviewPath: 1 } }],
    ["an unknown story status", { ...good, stories: { a: { status: "weird" } } }],
    ["an unknown design", { ...good, stories: { a: { status: "new", design: "current" } } }],
    ["an array of stories", { ...good, stories: [] }],
    ["a story that is not an object", { ...good, stories: { a: "new" } }],
  ])("refuses %s", (_name, value) => {
    expect(parseStoryStatus(value)).toBeNull();
  });
});
