import { describe, expect, it } from "vitest";
import { buildGraph } from "./stats.ts";
import { extractPackageUsage } from "./usage.ts";

const graph = buildGraph([
  {
    id: "src/Card.stories.tsx",
    importedIds: ["src/Card.tsx", "node_modules/@acme/ds/dist/Button.js"],
  },
  { id: "src/Card.tsx", importedIds: ["node_modules/react/index.js", "src/Tag.tsx"] },
  { id: "src/Tag.tsx", importedIds: ["node_modules/@acme/ds/dist/Tag.js"] },
  { id: "node_modules/@acme/ds/dist/Button.js", importedIds: ["node_modules/@acme/ds/dist/x.js"] },
  { id: "packages/ds/src/Badge.tsx", importedIds: [] },
  { id: "src/Badge.stories.tsx", importedIds: ["packages/ds/src/Badge.tsx"] },
])!;

describe("extractPackageUsage", () => {
  it("finds node_modules packages with the shallowest module per package", () => {
    const usage = extractPackageUsage(graph, ["src/Card.stories.tsx"], {
      "@acme/ds": {},
      react: {},
    });
    expect(usage).toEqual([
      {
        storyFile: "src/Card.stories.tsx",
        packageName: "@acme/ds",
        modulePath: "node_modules/@acme/ds/dist/Button.js",
      },
      {
        storyFile: "src/Card.stories.tsx",
        packageName: "react",
        modulePath: "node_modules/react/index.js",
      },
    ]);
  });

  it("ignores packages that are not tracked and never walks package internals", () => {
    const usage = extractPackageUsage(graph, ["src/Card.stories.tsx"], { "@acme/ds": {} });
    expect(usage.map((u) => u.packageName)).toEqual(["@acme/ds"]);
  });

  it("matches workspace-linked packages by root", () => {
    const usage = extractPackageUsage(graph, ["src/Badge.stories.tsx"], {
      "@acme/ds": { root: "packages/ds" },
    });
    expect(usage).toEqual([
      {
        storyFile: "src/Badge.stories.tsx",
        packageName: "@acme/ds",
        modulePath: "packages/ds/src/Badge.tsx",
      },
    ]);
  });

  it("returns nothing for stories missing from the graph", () => {
    expect(extractPackageUsage(graph, ["src/Nope.stories.tsx"], { react: {} })).toEqual([]);
  });
});
