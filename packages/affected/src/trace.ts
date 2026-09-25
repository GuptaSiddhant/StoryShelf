import { graphModulesFor } from "./stats.ts";
import type { DepGraph, TraceOptions } from "./types.ts";

/** Basenames whose change invalidates every story (global render setup). */
const GLOBAL_BASENAMES = new Set([
  "preview.js",
  "preview.jsx",
  "preview.ts",
  "preview.tsx",
  "preview.mjs",
  "preview.cjs",
  "preview.mts",
  "preview.cts",
  "manager.js",
  "manager.jsx",
  "manager.ts",
  "manager.tsx",
]);

/** Config basenames whose change may add, remove, or re-glob stories. */
const CONFIG_BASENAMES = new Set(["main.js", "main.ts", "main.mjs", "main.cjs", "main.mts"]);

/** Lockfiles whose change means dependency versions cannot be resolved. */
const LOCKFILE_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
]);

/** Basename of a repo-relative path. */
function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/** True when a changed file forces a full render of every story. */
function isGlobalFile(path: string): boolean {
  const base = basename(path);
  if (GLOBAL_BASENAMES.has(base) || CONFIG_BASENAMES.has(base) || LOCKFILE_BASENAMES.has(base)) {
    return true;
  }
  return path.includes(".storybook/") && (CONFIG_BASENAMES.has(base) || GLOBAL_BASENAMES.has(base));
}

/** Regex-special chars escaped when translating globs (kept discrete: no `${`). */
const REGEX_SPECIALS = new Set(["+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "."]);

/** Translate one glob token at `index` into regex text and advance width. */
function translateGlobToken(pattern: string, index: number): { text: string; advance: number } {
  const char = pattern[index];
  if (char === "*") {
    return pattern[index + 1] === "*" ? { text: ".*", advance: 2 } : { text: "[^/]*", advance: 1 };
  }
  if (char === "?") {
    return { text: "[^/]", advance: 1 };
  }
  if (char !== undefined && REGEX_SPECIALS.has(char)) {
    return { text: `\\${char}`, advance: 1 };
  }
  return { text: char ?? "", advance: 1 };
}

/** Escape regex syntax while translating `*`, `**`, and `?` globs. */
function globToRegExp(pattern: string): RegExp {
  const parts: string[] = [];
  let index = 0;
  while (index < pattern.length) {
    const token = translateGlobToken(pattern, index);
    parts.push(token.text);
    index += token.advance;
  }
  return new RegExp(`^${parts.join("")}$`, "u");
}

/** True when `path` matches any of the given glob patterns. */
export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

/** Queue reverse-edge dependents not yet visited. */
function pushUnseen(seen: Set<string>, pending: string[], dependents: readonly string[]): void {
  for (const dependent of dependents) {
    if (!seen.has(dependent)) {
      seen.add(dependent);
      pending.push(dependent);
    }
  }
}

/** Fold one graph node into the affected set and queue its dependents. */
function processNode(
  graph: DepGraph,
  storyOf: ReadonlyMap<string, string>,
  seen: Set<string>,
  pending: string[],
  affected: Set<string>,
  current: string,
): void {
  const story = storyOf.get(current);
  if (story !== undefined) {
    affected.add(story);
  }
  pushUnseen(seen, pending, graph.importedBy[current] ?? []);
}

/** Collect every story file reachable from `roots` via reverse edges. */
function reachableStories(
  graph: DepGraph,
  roots: string[],
  storyOf: ReadonlyMap<string, string>,
): Set<string> {
  const seen = new Set<string>(roots);
  const pending = [...roots];
  const affected = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    processNode(graph, storyOf, seen, pending, affected, current);
  }
  return affected;
}

/** Map every graph node to its story file (suffix match for absolute stats). */
function storyNodeMap(graph: DepGraph, storyFiles: readonly string[]): Map<string, string> {
  const nodes = new Set([...Object.keys(graph.imports), ...Object.keys(graph.importedBy)]);
  const map = new Map<string, string>();
  for (const story of storyFiles) {
    for (const node of nodes) {
      if ((node === story || node.endsWith(`/${story}`)) && !map.has(node)) {
        map.set(node, story);
      }
    }
  }
  return map;
}
/** Root modules for tracing: changed modules plus directly changed stories. */
function traceRoots(
  graph: DepGraph,
  relevant: string[],
  storyOf: ReadonlyMap<string, string>,
): string[] {
  const roots = changedModules(graph, relevant);
  for (const file of relevant) {
    if (storyOf.has(file)) {
      roots.push(file);
    }
  }
  return [...new Set(roots)];
}
/** Map changed files to graph modules, dropping files outside the graph. */
function changedModules(graph: DepGraph, changed: string[]): string[] {
  const modules = new Set<string>();
  for (const file of changed) {
    for (const module of graphModulesFor(graph, file)) {
      modules.add(module);
    }
  }
  return [...modules];
}

/**
 * Trace changed files through the dependency graph to story files.
 *
 * @param graph - Bidirectional module graph of the built Storybook.
 * @param changedFiles - Repo-relative changed files.
 * @param storyFiles - Normalized story import paths from the story index.
 * @param options - Untraced globs excluded from tracing.
 * @returns Affected story files, or `null` when everything must render.
 */
export function traceAffected(
  graph: DepGraph,
  changedFiles: string[],
  storyFiles: readonly string[],
  options: TraceOptions = {},
): string[] | null {
  const untraced = options.untraced ?? [];
  const relevant = changedFiles.filter((file) => !matchesAnyGlob(file, untraced));
  const forcing = relevant.find((file) => isGlobalFile(file));
  if (forcing !== undefined) {
    return null;
  }
  const storyOf = storyNodeMap(graph, storyFiles);
  const roots = traceRoots(graph, relevant, storyOf);
  return [...reachableStories(graph, roots, storyOf)].toSorted();
}
