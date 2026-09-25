import { describe, expect, it } from "vitest";
import { buildGraph } from "./stats.ts";
import { matchesAnyGlob, traceAffected } from "./trace.ts";
import type { DepGraph } from "./types.ts";

function fixtureGraph(): DepGraph {
  const graph = buildGraph([
    { id: "src/Button.stories.tsx", importedIds: ["src/Button.tsx"] },
    { id: "src/Button.tsx", importedIds: ["src/theme.ts"] },
    { id: "src/Card.stories.tsx", importedIds: ["src/Card.tsx"] },
  ]);
  if (!graph) {
    throw new Error("fixture graph must build");
  }
  return graph;
}

const STORIES = ["src/Button.stories.tsx", "src/Card.stories.tsx"];

describe("matchesAnyGlob", () => {
  it("supports *, **, and ? segments", () => {
    expect(matchesAnyGlob("src/a.generated.ts", ["**/*.generated.ts"])).toBe(true);
    expect(matchesAnyGlob("src/a.ts", ["**/*.generated.ts"])).toBe(false);
    expect(matchesAnyGlob("src/a.ts", ["src/*.ts"])).toBe(true);
    expect(matchesAnyGlob("src/nested/a.ts", ["src/*.ts"])).toBe(false);
    expect(matchesAnyGlob("src/ab.ts", ["src/a?.ts"])).toBe(true);
  });
});

describe("traceAffected", () => {
  it("traces transitive dependents to stories", () => {
    expect(traceAffected(fixtureGraph(), ["src/theme.ts"], STORIES)).toEqual([
      "src/Button.stories.tsx",
    ]);
  });

  it("includes directly changed story files", () => {
    expect(traceAffected(fixtureGraph(), ["src/Card.stories.tsx"], STORIES)).toEqual([
      "src/Card.stories.tsx",
    ]);
  });

  it("returns an empty set when nothing is reachable", () => {
    expect(traceAffected(fixtureGraph(), ["scripts/ci.sh"], STORIES)).toEqual([]);
  });

  it("drops untraced files before tracing", () => {
    expect(
      traceAffected(fixtureGraph(), ["src/theme.ts"], STORIES, {
        untraced: ["**/theme.ts"],
      }),
    ).toEqual([]);
  });

  it("returns null for global setup files", () => {
    expect(traceAffected(fixtureGraph(), [".storybook/preview.ts"], STORIES)).toBeNull();
    expect(
      traceAffected(fixtureGraph(), ["src/Button.tsx", ".storybook/main.ts"], STORIES),
    ).toBeNull();
  });

  it("returns null for lockfile changes", () => {
    expect(traceAffected(fixtureGraph(), ["pnpm-lock.yaml"], STORIES)).toBeNull();
    expect(traceAffected(fixtureGraph(), ["package.json"], STORIES)).toBeNull();
  });

  it("matches absolute stats paths against repo-relative changes", () => {
    const graph = buildGraph([{ id: "/repo/src/a.stories.tsx", importedIds: ["/repo/src/a.tsx"] }]);
    if (!graph) {
      throw new Error("fixture graph must build");
    }
    expect(traceAffected(graph, ["src/a.tsx"], ["src/a.stories.tsx"])).toEqual([
      "src/a.stories.tsx",
    ]);
  });
});
