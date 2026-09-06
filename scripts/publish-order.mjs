#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Shared publish ordering for the release pipeline. Both registry publishers
 * derive package order from manifests instead of hardcoding it: a topological
 * sort over runtime `dependencies` within the workspace scope, so dependents
 * always publish after their dependencies.
 *
 * Only runtime `dependencies` form edges — devDependencies are test-only and
 * never shipped, so they must not constrain publish order. Edges key on
 * membership (dep name is a workspace member), never on the version string,
 * so ordering is correct both before and after the `workspace:*` rewrite.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { dirname } = import.meta;
const packagesDir = join(dirname, "..", "packages");

export const PUBLISH_SCOPE = "@storyshelf";

/**
 * Directories of public workspace packages: not private, with a name.
 *
 * @returns {string[]} Package directory names.
 */
export function getPublicPackageDirs() {
  const dirs = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(join(packagesDir, entry.name, "package.json"), "utf8"));
      if (pkg.private === true || !pkg.name) {
        continue;
      }
      dirs.push(entry.name);
    } catch {
      // Ignore missing or invalid package.json
    }
  }
  return dirs;
}

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Kahn's topological sort with a lexicographically-sorted ready queue, so
 * output is deterministic. Throws on cycles.
 *
 * @param {string[]} nodes All node names.
 * @param {Map<string, string[]>} edges Map of node to its dependencies.
 * @returns {string[]} Nodes in dependency-first order.
 */
export function topoSort(nodes, edges) {
  const dependents = new Map(nodes.map((node) => [node, []]));
  const inDegree = new Map(nodes.map((node) => [node, 0]));
  for (const node of nodes) {
    const seen = new Set();
    for (const dep of edges.get(node) ?? []) {
      if (dep === node || seen.has(dep) || !dependents.has(dep)) {
        continue;
      }
      seen.add(dep);
      dependents.get(dep).push(node);
      inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
    }
  }
  const ready = nodes.filter((node) => inDegree.get(node) === 0).toSorted();
  const order = [];
  while (ready.length > 0) {
    const node = ready.shift();
    order.push(node);
    for (const dependent of dependents.get(node).toSorted()) {
      inDegree.set(dependent, inDegree.get(dependent) - 1);
      if (inDegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (order.length !== nodes.length) {
    const stuck = nodes.filter((node) => !order.includes(node)).toSorted();
    throw new Error(`dependency cycle detected among: ${stuck.join(", ")}`);
  }
  return order;
}

/**
 * Public package directories in publish order (dependencies first).
 *
 * @returns {string[]} Directory names, deterministic.
 */
export function getPublishOrder() {
  const dirs = getPublicPackageDirs();
  const names = new Map();
  for (const dir of dirs) {
    const pkg = readManifest(dir);
    if (pkg?.name) {
      names.set(pkg.name, dir);
    }
  }
  const edges = new Map();
  for (const dir of dirs) {
    const pkg = readManifest(dir);
    const deps = [];
    for (const name of Object.keys(pkg?.dependencies ?? {})) {
      if (name.startsWith(`${PUBLISH_SCOPE}/`) && names.has(name)) {
        deps.push(names.get(name));
      }
    }
    edges.set(dir, deps);
  }
  return topoSort(dirs, edges);
}

/**
 * Run one package's publish command, failing the process on error.
 *
 * @param {string} dir Package directory name.
 * @param {string} cmd Binary to run.
 * @param {string[]} args Arguments.
 * @param {string} label Human-readable label for logs.
 */
export function runPublishStep(dir, cmd, args, label) {
  console.log(`Publishing ${PUBLISH_SCOPE}/${dir}`);
  const result = spawnSync(cmd, args, {
    cwd: join(packagesDir, dir),
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`::error::${label} publish failed for ${PUBLISH_SCOPE}/${dir}`);
    process.exit(result.status ?? 1);
  }
}
