import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { keyOfModuleId, type PathBase } from "./paths.ts";
import type { DepGraph } from "./types.ts";

/** Basename of the Vite stats file emitted next to a built Storybook. */
export const STATS_FILENAME = "preview-stats.json";

/** Candidate index files listing a built Storybook's stories. */
const INDEX_CANDIDATES = ["stories.json", "index.json"];

/** A single module entry in a stats file (Vite or Webpack shape). */
interface StatsModule {
  id?: unknown;
  name?: unknown;
  identifier?: unknown;
  imported?: unknown;
  importedIds?: unknown;
  dependencies?: unknown;
  reasons?: unknown;
}

interface StoryIndex {
  entries?: Record<string, { importPath?: unknown }>;
}

/**
 * Strip bundler module-id decoration so sub-modules fold into their file:
 * webpack loader chains (`a-loader!b-loader??opts!./Button.vue`) keep only
 * the resource after the last `!`, and `?query` suffixes
 * (`Button.vue?vue&type=script`, `Card.svelte?svelte&type=style`) are dropped.
 */
export function stripQueryAndLoader(value: string): string {
  const resource = value.slice(value.lastIndexOf("!") + 1);
  const queryStart = resource.indexOf("?");
  return queryStart === -1 ? resource : resource.slice(0, queryStart);
}

/** Normalize a stats path to a repo-relative posix form for comparison. */
export function normalizePath(value: string): string {
  return stripQueryAndLoader(value)
    .replaceAll("\\", "/")
    .replaceAll(/^\.\//gu, "")
    .replaceAll(/^\//gu, "");
}

/** Turns a raw stats path into the key the graph is built on. */
type KeyOf = (raw: string) => string;

/**
 * The graph key of a raw stats path: its legacy normalized form, or with a {@link PathBase} the
 * absolute path it names, so it can only meet a changed file that is the same file (#502).
 */
function keyFor(base?: PathBase): KeyOf {
  if (!base) return normalizePath;
  return (raw) => keyOfModuleId(base, stripQueryAndLoader(raw)) ?? normalizePath(raw);
}

/** True when stats module `candidate` refers to repo-relative file `target`. */
function matchesFile(candidate: string, target: string): boolean {
  if (candidate === target) {
    return true;
  }
  return candidate.endsWith(`/${target}`);
}

/** Coerce an unknown stats value to a list of normalized paths. */
function asPathList(value: unknown, keyOf: KeyOf): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const paths: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.length > 0) {
      paths.push(keyOf(entry));
    }
  }
  return paths;
}

/** Read a non-empty string field from a stats module entry. */
function stringField(entry: StatsModule, key: "id" | "name" | "identifier"): string | null {
  const value = entry[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read the file a stats module entry refers to, if any. */
function moduleFile(entry: StatsModule, keyOf: KeyOf): string | null {
  const raw =
    stringField(entry, "id") ?? stringField(entry, "name") ?? stringField(entry, "identifier");
  return raw === null ? null : keyOf(raw);
}

/** Forward imports declared by a stats module entry, if any. */
function moduleImports(entry: StatsModule, keyOf: KeyOf): string[] {
  return asPathList(entry.imported ?? entry.importedIds ?? entry.dependencies, keyOf);
}

/** Dependent names declared via Webpack-style `reasons`, if any. */
function moduleReasonNames(entry: StatsModule, keyOf: KeyOf): string[] {
  if (!Array.isArray(entry.reasons)) {
    return [];
  }
  const names: string[] = [];
  for (const reason of entry.reasons) {
    if (typeof reason === "object" && reason !== null) {
      const record = reason as Record<string, unknown>;
      const name = record["moduleName"] ?? record["module"];
      if (typeof name === "string" && name.length > 0) {
        names.push(keyOf(name));
      }
    }
  }
  return names;
}

/** Attach a record-shaped module entry to its name. */
function entryWithName(name: string, value: unknown): StatsModule {
  if (typeof value === "object" && value !== null) {
    return { name, ...(value as StatsModule) };
  }
  return { name };
}

/** Extract module entries from a parsed stats document of unknown shape. */
function moduleEntries(document: unknown): StatsModule[] {
  if (typeof document !== "object" || document === null) {
    return [];
  }
  const record = document as Record<string, unknown>;
  const raw = record["modules"];
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is StatsModule => typeof entry === "object");
  }
  if (typeof raw === "object" && raw !== null) {
    return Object.entries(raw as Record<string, unknown>).map(([name, value]) =>
      entryWithName(name, value),
    );
  }
  return [];
}

/** Record one directed edge in the graph under construction. */
function addEdge(
  imports: Map<string, Set<string>>,
  importedBy: Map<string, Set<string>>,
  from: string,
  to: string,
): void {
  if (from === to) {
    return;
  }
  const forward = imports.get(from) ?? new Set<string>();
  forward.add(to);
  imports.set(from, forward);
  const reverse = importedBy.get(to) ?? new Set<string>();
  reverse.add(from);
  importedBy.set(to, reverse);
}

/** Add one stats entry's edges to the graph under construction. */
function addEntryEdges(
  imports: Map<string, Set<string>>,
  importedBy: Map<string, Set<string>>,
  entry: StatsModule,
  keyOf: KeyOf,
): void {
  const file = moduleFile(entry, keyOf);
  if (!file) {
    return;
  }
  for (const imported of moduleImports(entry, keyOf)) {
    addEdge(imports, importedBy, file, imported);
  }
  for (const dependent of moduleReasonNames(entry, keyOf)) {
    addEdge(imports, importedBy, dependent, file);
  }
}
function toGraph(
  imports: Map<string, Set<string>>,
  importedBy: Map<string, Set<string>>,
): DepGraph {
  return {
    imports: Object.fromEntries([...imports].map(([file, set]) => [file, [...set].toSorted()])),
    importedBy: Object.fromEntries(
      [...importedBy].map(([file, set]) => [file, [...set].toSorted()]),
    ),
  };
}

/**
 * Build a bidirectional dependency graph from parsed stats modules.
 *
 * @param entries - Module entries from a Vite or Webpack stats document.
 * @param base - Resolve module ids to absolute paths against these roots; without it ids keep
 * their legacy normalized, repo-relative-looking form.
 * @returns Bidirectional graph, or `null` when no usable edges exist.
 */
export function buildGraph(entries: StatsModule[], base?: PathBase): DepGraph | null {
  const keyOf = keyFor(base);
  const imports = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();
  for (const entry of entries) {
    addEntryEdges(imports, importedBy, entry, keyOf);
  }
  if (imports.size === 0) {
    return null;
  }
  return toGraph(imports, importedBy);
}

/**
 * Load and parse a stats file into a dependency graph.
 *
 * @param statsPath - Absolute or cwd-relative path to the stats JSON file.
 * @param base - See {@link buildGraph}.
 * @returns Graph, or `null` when the file is missing or unrecognized.
 */
export async function loadDepGraph(statsPath: string, base?: PathBase): Promise<DepGraph | null> {
  let raw: string;
  try {
    raw = await readFile(statsPath, "utf8");
  } catch {
    return null;
  }
  let document: unknown;
  try {
    document = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  return buildGraph(moduleEntries(document), base);
}

/** Resolve the stats file path for a built Storybook directory. */
export function statsPathFor(cwd: string, buildDir: string, override?: string): string {
  if (override) {
    return resolve(cwd, override);
  }
  return join(resolve(cwd, buildDir), STATS_FILENAME);
}

/**
 * Load the deduplicated story import paths from a built Storybook's index.
 *
 * @param cwd - Repository root.
 * @param buildDir - Built Storybook directory.
 * @returns Normalized import paths; throws when no index is readable.
 */
export async function loadStoryImportPaths(cwd: string, buildDir: string): Promise<string[]> {
  const root = resolve(cwd, buildDir);
  const documents = await Promise.all(
    INDEX_CANDIDATES.map(async (name) => {
      try {
        return JSON.parse(await readFile(join(root, name), "utf8")) as StoryIndex;
      } catch {
        return null;
      }
    }),
  );
  const found = documents.find((document) => document !== null);
  if (!found?.entries) {
    throw new Error(`No Storybook index found in ${root}`);
  }
  const paths = new Set<string>();
  for (const entry of Object.values(found.entries)) {
    if (typeof entry.importPath === "string" && entry.importPath.length > 0) {
      paths.add(normalizePath(entry.importPath));
    }
  }
  return [...paths].toSorted();
}

/** Find graph modules referring to repo-relative file `target`. */
export function graphModulesFor(graph: DepGraph, target: string): string[] {
  const matched: string[] = [];
  for (const file of Object.keys(graph.imports)) {
    if (matchesFile(file, target)) {
      matched.push(file);
    }
  }
  for (const file of Object.keys(graph.importedBy)) {
    if (matchesFile(file, target) && !matched.includes(file)) {
      matched.push(file);
    }
  }
  return matched;
}
