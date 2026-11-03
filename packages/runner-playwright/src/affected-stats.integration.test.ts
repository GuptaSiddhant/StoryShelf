import { StorybookAdapter } from "@storyshelf/core/capture";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureFixtureBuilt } from "./integration-harness.ts";

/** Story files of the built fixture, spelled as the dependency graph names them (no leading `./`). */
async function storyFiles(dir: string): Promise<string[]> {
  const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as {
    entries: Record<string, { importPath?: string }>;
  };
  const paths = Object.values(index.entries).flatMap((entry) =>
    entry.importPath ? [entry.importPath.replace(/^\.\//u, "")] : [],
  );
  return [...new Set(paths)];
}

/**
 * The fixtures build with `--stats-json` (#499), so affected capture has a real dependency graph
 * to read in CI and the nightly runs instead of falling back to a full render.
 */
describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "fixture stats for affected capture",
  () => {
    it("builds a dependency graph that reaches every story file and the components they import", async () => {
      const dir = await ensureFixtureBuilt();
      const graph = await new StorybookAdapter().loadDependencyGraph(dir);
      expect(graph, "preview-stats.json is missing or has no edges").not.toBeNull();
      if (!graph) return;

      const stories = await storyFiles(dir);
      expect(stories.length).toBeGreaterThan(0);
      const nodes = new Set([...Object.keys(graph.imports), ...Object.keys(graph.importedBy)]);
      // A change to a story file can only affect that story if the file is a node of the graph.
      expect(stories.filter((story) => !nodes.has(story))).toEqual([]);

      // And a source file a story imports leads back to that story: the trace affected capture runs.
      const storySet = new Set(stories);
      const components = Object.entries(graph.importedBy).filter(
        ([file, dependents]) =>
          !file.includes("node_modules") &&
          !storySet.has(file) &&
          dependents.some((dependent) => storySet.has(dependent)),
      );
      expect(components.length).toBeGreaterThan(0);
    });
  },
);
