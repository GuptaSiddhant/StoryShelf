import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach } from "vitest";
import {
  buildGraph,
  loadDepGraph,
  loadStoryImportPaths,
  normalizePath,
  stripQueryAndLoader,
} from "./stats.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-affected-stats-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("normalizePath", () => {
  it("strips leading ./ and / and backslashes", () => {
    expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizePath("/src/a.ts")).toBe("src/a.ts");
    expect(normalizePath(String.raw`src\a.ts`)).toBe("src/a.ts");
  });
});

describe("stripQueryAndLoader", () => {
  it("drops ?query suffixes (Vue, Svelte, Vite)", () => {
    expect(stripQueryAndLoader("src/Button.vue?vue&type=script&lang.ts")).toBe("src/Button.vue");
    expect(stripQueryAndLoader("src/Card.svelte?svelte&type=style&lang.css")).toBe(
      "src/Card.svelte",
    );
  });

  it("keeps only the resource after webpack loader prefixes", () => {
    expect(
      stripQueryAndLoader(
        "../node_modules/vue-loader/dist/index.js??ruleSet[1].rules[2]!./src/Button.vue?vue&type=script",
      ),
    ).toBe("./src/Button.vue");
    expect(stripQueryAndLoader("style-loader!css-loader!./a.css")).toBe("./a.css");
  });

  it("leaves plain paths untouched", () => {
    expect(stripQueryAndLoader("src/a.ts")).toBe("src/a.ts");
  });

  it("is applied by normalizePath", () => {
    expect(normalizePath("./src/Button.vue?vue&type=script")).toBe("src/Button.vue");
  });
});

describe("buildGraph", () => {
  it("folds Vue/Svelte sub-modules into the component file", () => {
    const graph = buildGraph([
      { id: "/src/Button.stories.ts", importedIds: ["/src/Button.vue"] },
      { id: "/src/Button.vue", importedIds: ["/src/Button.vue?vue&type=script&lang.ts"] },
      { id: "/src/Button.vue?vue&type=script&lang.ts", importedIds: ["/src/tokens.ts"] },
      { id: "/src/Card.svelte?svelte&type=style&lang.css", importedIds: ["/src/card.css"] },
    ]);
    expect(graph?.imports["src/Button.vue"]).toEqual(["src/tokens.ts"]);
    expect(graph?.importedBy["src/Button.vue"]).toEqual(["src/Button.stories.ts"]);
    expect(graph?.imports["src/Card.svelte"]).toEqual(["src/card.css"]);
  });

  it("matches webpack loader-prefixed reasons", () => {
    const graph = buildGraph([
      {
        name: "./src/Button.vue",
        reasons: [{ moduleName: "vue-loader!./src/Button.stories.ts?x" }],
      },
    ]);
    expect(graph?.importedBy["src/Button.vue"]).toEqual(["src/Button.stories.ts"]);
  });

  it("builds bidirectional edges from Vite forward imports", () => {
    const graph = buildGraph([
      { id: "src/Button.stories.tsx", importedIds: ["src/Button.tsx"] },
      { id: "src/Button.tsx", importedIds: ["src/theme.ts"] },
      { id: "src/Card.stories.tsx", importedIds: ["src/Card.tsx"] },
    ]);
    expect(graph?.importedBy["src/Button.tsx"]).toEqual(["src/Button.stories.tsx"]);
    expect(graph?.imports["src/Button.stories.tsx"]).toEqual(["src/Button.tsx"]);
    expect(graph?.importedBy["src/Card.tsx"]).toEqual(["src/Card.stories.tsx"]);
  });

  it("merges Webpack-style reasons as reverse edges", () => {
    const graph = buildGraph([
      { name: "src/theme.ts", reasons: [{ moduleName: "src/Button.tsx" }] },
      { name: "src/Button.tsx", reasons: [{ moduleName: "src/Button.stories.tsx" }] },
    ]);
    expect(graph?.importedBy["src/theme.ts"]).toEqual(["src/Button.tsx"]);
    expect(graph?.imports["src/Button.tsx"]).toEqual(["src/theme.ts"]);
  });

  it("supports record-shaped module maps", () => {
    const graph = buildGraph([]);
    expect(graph).toBeNull();
  });

  it("returns null when no usable edges exist", () => {
    expect(buildGraph([{ id: "lonely.ts" }])).toBeNull();
    expect(buildGraph([])).toBeNull();
    expect(buildGraph([{ id: 42 }])).toBeNull();
  });
});

describe("loadDepGraph", () => {
  it("returns null for missing or invalid files", async () => {
    await expect(loadDepGraph(join(dir, "missing.json"))).resolves.toBeNull();
    writeFileSync(join(dir, "bad.json"), "not json{");
    await expect(loadDepGraph(join(dir, "bad.json"))).resolves.toBeNull();
    writeFileSync(join(dir, "empty.json"), JSON.stringify({ chunks: [] }));
    await expect(loadDepGraph(join(dir, "empty.json"))).resolves.toBeNull();
  });

  it("parses a Vite stats file", async () => {
    writeFileSync(
      join(dir, "preview-stats.json"),
      JSON.stringify({
        modules: [{ id: "src/a.stories.tsx", importedIds: ["src/a.tsx"] }],
      }),
    );
    const graph = await loadDepGraph(join(dir, "preview-stats.json"));
    expect(graph?.importedBy["src/a.tsx"]).toEqual(["src/a.stories.tsx"]);
  });
});

function writeIndex(target: string, name: string): void {
  mkdirSync(join(target, "static"), { recursive: true });
  writeFileSync(
    join(target, "static", name),
    JSON.stringify({
      v: 5,
      entries: {
        a: { id: "a", importPath: "src/a.stories.tsx" },
        b: { id: "b", importPath: "src/b.stories.tsx" },
        docs: { id: "docs", importPath: "src/docs.mdx" },
        noimport: { id: "noimport" },
      },
    }),
  );
}

describe("loadStoryImportPaths", () => {
  it("reads import paths from index.json", async () => {
    writeIndex(dir, "index.json");
    await expect(loadStoryImportPaths(dir, "static")).resolves.toEqual([
      "src/a.stories.tsx",
      "src/b.stories.tsx",
      "src/docs.mdx",
    ]);
  });

  it("falls back to stories.json", async () => {
    writeIndex(dir, "stories.json");
    await expect(loadStoryImportPaths(dir, "static")).resolves.toEqual([
      "src/a.stories.tsx",
      "src/b.stories.tsx",
      "src/docs.mdx",
    ]);
  });

  it("throws when no index exists", async () => {
    mkdirSync(join(dir, "empty"), { recursive: true });
    await expect(loadStoryImportPaths(dir, "empty")).rejects.toThrow("No Storybook index");
  });
});
