import { graphModulesFor } from "./stats.ts";
import type { DepGraph } from "./types.ts";

/** A dependency package a story file reaches, and the first module that reaches it. */
export interface PackageUsage {
  /** Story file (repo-relative, as given by the Storybook index). */
  storyFile: string;
  packageName: string;
  /** Graph module inside the package (a `node_modules/<pkg>/…` path or a workspace source file). */
  modulePath: string;
}

/** Where a tracked package lives: always `node_modules`, plus a workspace dir when linked. */
export interface TrackedPackage {
  /** Repo-relative directory of a workspace-linked package (outside `node_modules`). */
  root?: string;
}

const NODE_MODULES = "node_modules/";

/** Package name for a `…/node_modules/<pkg>/…` module path, handling scopes. */
function nodeModulesPackage(module: string): string | null {
  const start = module.lastIndexOf(NODE_MODULES);
  if (start === -1) {
    return null;
  }
  const [first, second] = module.slice(start + NODE_MODULES.length).split("/");
  if (!first) {
    return null;
  }
  return first.startsWith("@") && second ? `${first}/${second}` : first;
}

/** Tracked package that owns `module`, via `node_modules` or a workspace root. */
function owningPackage(module: string, tracked: Map<string, TrackedPackage>): string | null {
  const installed = nodeModulesPackage(module);
  if (installed !== null) {
    return tracked.has(installed) ? installed : null;
  }
  for (const [name, { root }] of tracked) {
    if (root && module.startsWith(`${root}/`)) {
      return name;
    }
  }
  return null;
}

/** Mutable state of one story's breadth-first walk. */
interface Walk {
  seen: Set<string>;
  found: Map<string, PackageUsage>;
  next: string[];
}

/** Classify one imported module: record a package hit, or queue it for expansion. */
function visitDep(
  walk: Walk,
  dep: string,
  storyFile: string,
  tracked: Map<string, TrackedPackage>,
): void {
  if (walk.seen.has(dep)) {
    return;
  }
  walk.seen.add(dep);
  const owner = owningPackage(dep, tracked);
  if (owner === null) {
    walk.next.push(dep);
  } else if (!walk.found.has(owner)) {
    walk.found.set(owner, { storyFile, packageName: owner, modulePath: dep });
  }
}

/** Breadth-first walk of one story's imports, recording the shallowest hit per package. */
function usageForStory(
  graph: DepGraph,
  storyFile: string,
  start: string[],
  tracked: Map<string, TrackedPackage>,
): PackageUsage[] {
  const walk: Walk = { seen: new Set(start), found: new Map(), next: [] };
  let frontier = start;
  while (frontier.length > 0) {
    walk.next = [];
    for (const dep of frontier.flatMap((module) => graph.imports[module] ?? [])) {
      visitDep(walk, dep, storyFile, tracked);
    }
    frontier = walk.next;
  }
  return [...walk.found.values()];
}

/**
 * Find which tracked dependency packages each story reaches through its
 * import graph. Traversal stops at a package boundary (its internals are not
 * walked) and records only the shallowest module per package, so a story
 * yields at most one row per package.
 *
 * @param graph - Bidirectional module graph from the build's stats file.
 * @param storyFiles - Story import paths from the Storybook index.
 * @param packages - Packages to track (e.g. the project's declared dependencies).
 */
export function extractPackageUsage(
  graph: DepGraph,
  storyFiles: readonly string[],
  packages: Record<string, TrackedPackage>,
): PackageUsage[] {
  const tracked = new Map(Object.entries(packages));
  return storyFiles.flatMap((storyFile) =>
    usageForStory(graph, storyFile, graphModulesFor(graph, storyFile), tracked),
  );
}
