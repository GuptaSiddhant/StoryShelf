import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;
const IMPORT = /(?:from|import)\s*\(?\s*["'](?<spec>[^"']+)["']/gu;

/** The specifiers `file` imports (static and dynamic), by source scan. */
function specifiersOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(IMPORT)].map(
    (match) => match.groups?.["spec"] ?? "",
  );
}

/** Every file reachable from `entry` through relative imports, with the bare packages each one names. */
function reachable(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const specs = specifiersOf(file);
    seen.set(file, specs);
    for (const spec of specs.filter((candidate) => candidate.startsWith("."))) {
      const target = resolve(dirname(file), spec);
      queue.push(target.replace(/\.js$/u, ".ts"));
    }
  }
  return seen;
}

describe("importing @storyshelf/app", () => {
  it("never reaches @hono/node-server: only the /node subpath does", () => {
    const graph = reachable(join(SRC, "index.tsx"));
    expect(graph.size).toBeGreaterThan(100);
    const offenders = [...graph].filter(([, specs]) =>
      specs.some((spec) => spec === "@hono/node-server" || spec.startsWith("@hono/node-server/")),
    );
    expect(offenders.map(([file]) => file)).toEqual([]);
    expect([...graph.keys()].some((file) => file.includes(`${join(SRC, "node")}/`))).toBe(false);
    expect([...graph.keys()].some((file) => file.includes("/server-bin/"))).toBe(false);
  });
});
