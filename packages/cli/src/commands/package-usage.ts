import {
  extractPackageUsage,
  loadDepGraph,
  loadStoryImportPaths,
  statsPathFor,
  type TrackedPackage,
} from "@storyshelf/affected";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { PackageUsageInput } from "../client.ts";

/** Dependency sections of `package.json` whose packages are tracked. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;

/** A tracked package with its installed version. */
interface ResolvedPackage {
  tracked: TrackedPackage;
  version: string | null;
}

/** Inputs for collecting package usage from a built Storybook. */
export interface CollectUsageOptions {
  cwd: string;
  buildDir: string;
  statsFile?: string;
}

/** Names declared in the project's `package.json`, or none when unreadable. */
async function declaredPackages(cwd: string): Promise<string[]> {
  try {
    const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const names = DEPENDENCY_FIELDS.flatMap((field) => {
      const section = manifest[field];
      return typeof section === "object" && section !== null ? Object.keys(section) : [];
    });
    return [...new Set(names)];
  } catch {
    return [];
  }
}

/** Nearest `node_modules/<name>` directory walking up from `cwd` (hoisted installs), if any. */
function installedDir(cwd: string, name: string): string | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    if (dirname(dir) === dir) {
      return null;
    }
  }
}

/** Installed version and, for workspace links, the real source directory. */
async function resolvePackage(cwd: string, name: string): Promise<ResolvedPackage> {
  const dir = installedDir(cwd, name);
  if (dir === null) {
    return { tracked: {}, version: null };
  }
  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
    version?: unknown;
  };
  const version = typeof manifest.version === "string" ? manifest.version : null;
  const real = relative(await realpath(cwd), await realpath(dir));
  const linked = !real.startsWith("..") && !real.split(sep).includes("node_modules");
  return { tracked: linked ? { root: real.split(sep).join("/") } : {}, version };
}

/**
 * Collect which declared dependency packages each story reaches, with the
 * installed version. Resolves `[]` (never throws) when the build has no usable
 * stats or the project declares no dependencies.
 */
export async function collectPackageUsage(
  options: CollectUsageOptions,
): Promise<PackageUsageInput[]> {
  const names = await declaredPackages(options.cwd);
  if (names.length === 0) {
    return [];
  }
  const graph = await loadDepGraph(statsPathFor(options.cwd, options.buildDir, options.statsFile));
  const stories = await loadStoryImportPaths(options.cwd, options.buildDir).catch(() => []);
  if (!graph || stories.length === 0) {
    return [];
  }
  const resolved = new Map(
    await Promise.all(
      names.map(async (name) => [name, await resolvePackage(options.cwd, name)] as const),
    ),
  );
  const tracked = Object.fromEntries([...resolved].map(([name, pkg]) => [name, pkg.tracked]));
  return extractPackageUsage(graph, stories, tracked).map((usage) => ({
    storyImportPath: usage.storyFile,
    packageName: usage.packageName,
    modulePath: usage.modulePath,
    version: resolved.get(usage.packageName)?.version ?? null,
  }));
}
