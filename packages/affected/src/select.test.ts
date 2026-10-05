import { describe, expect, it } from "vitest";
import { selectAffectedStories } from "./select.ts";

const STORIES = [
  { id: "a", importPath: "src/a.stories.tsx" },
  { id: "b", importPath: "src/b.stories.tsx" },
  { id: "c", importPath: undefined },
];

describe("selectAffectedStories", () => {
  it("renders everything when the affected set is null", () => {
    const { render, inherit } = selectAffectedStories(STORIES, null);
    expect(render).toHaveLength(3);
    expect(inherit).toEqual([]);
  });

  it("partitions by import path", () => {
    const { render, inherit } = selectAffectedStories(STORIES, ["src/a.stories.tsx"]);
    expect(render.map((story) => story.id)).toEqual(["a", "c"]);
    expect(inherit.map((story) => story.id)).toEqual(["b"]);
  });

  it("inherits everything when the affected set is empty", () => {
    const { render, inherit } = selectAffectedStories(STORIES, []);
    expect(render.map((story) => story.id)).toEqual(["c"]);
    expect(inherit.map((story) => story.id)).toEqual(["a", "b"]);
  });
});
