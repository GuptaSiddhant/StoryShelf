import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { installLine } from "../missing-peer.ts";
import { satisfies } from "../semver-lite.ts";
import type { Check } from "./doctor.ts";

interface InstalledManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/** An installed package: where node found it (resolved through symlinks) and its manifest. */
interface Installed {
  dir: string;
  manifest: InstalledManifest;
}

function readManifest(file: string): InstalledManifest | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as InstalledManifest;
  } catch {
    return undefined;
  }
}

/** Find `name` the way node does: `node_modules/<name>` in `from`, then in each parent directory. */
export function findInstalled(name: string, from: string): Installed | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    const manifest = existsSync(candidate)
      ? readManifest(join(candidate, "package.json"))
      : undefined;
    if (manifest !== undefined) return { dir: realpathSync(candidate), manifest };
    if (dirname(dir) === dir) return undefined;
  }
}

/** The `@storyshelf/*` packages the project names (any dependency field), in sorted order. */
function declaredOwn(project: InstalledManifest): string[] {
  const names = new Set<string>();
  for (const field of [project.dependencies, project.devDependencies, project.peerDependencies]) {
    for (const name of Object.keys(field ?? {}))
      if (name.startsWith("@storyshelf/")) names.add(name);
  }
  return [...names].toSorted();
}

function peerCheck(
  owner: string,
  peer: string,
  wanted: string,
  optional: boolean,
  found: Installed | undefined,
): Check | undefined {
  if (found === undefined) {
    return optional
      ? undefined
      : {
          status: "fail",
          message: `${owner}: peer ${peer} is missing. Install it: ${installLine(peer, wanted)}`,
        };
  }
  const version = found.manifest.version ?? "unknown";
  const inRange = wanted.startsWith("workspace:") || satisfies(version, wanted);
  return inRange
    ? {
        status: "pass",
        message: `${owner}: peer ${peer} ${version} is installed (wants ${wanted})`,
      }
    : {
        status: "fail",
        message: `${owner}: peer ${peer} ${version} is out of range (wants ${wanted}). Install it: ${installLine(peer, wanted)}`,
      };
}

/** Each peer of an installed package: installed, out of range or missing (an absent optional peer is silent). */
function peersOf(installed: Installed): Check[] {
  const owner = installed.manifest.name ?? "unknown";
  return Object.entries(installed.manifest.peerDependencies ?? {})
    .toSorted(([one], [two]) => one.localeCompare(two))
    .flatMap(([peer, wanted]) => {
      const optional = installed.manifest.peerDependenciesMeta?.[peer]?.optional === true;
      const check = peerCheck(owner, peer, wanted, optional, findInstalled(peer, installed.dir));
      return check === undefined ? [] : [check];
    });
}

/** One version across every installed `@storyshelf/*` package. */
function skewCheck(installed: Installed[]): Check {
  const versions = new Map<string, string[]>();
  for (const { manifest } of installed) {
    const version = manifest.version ?? "unknown";
    versions.set(version, [...(versions.get(version) ?? []), manifest.name ?? "unknown"]);
  }
  if (versions.size <= 1) {
    return {
      status: "pass",
      message: `All ${installed.length} @storyshelf/* packages are at ${[...versions.keys()][0] ?? "none"}`,
    };
  }
  const listing = [...versions]
    .map(([version, names]) => `${version} (${names.join(", ")})`)
    .join("; ");
  return {
    status: "fail",
    message: `Mixed @storyshelf/* versions: ${listing}. Install them all at one version.`,
  };
}

/** Exactly one copy of core: the one the project resolves and the one each package resolves. */
function coreCopyCheck(project: string, installed: Installed[]): Check {
  const copies = new Set<string>();
  for (const from of [project, ...installed.map(({ dir }) => dir)]) {
    const core = findInstalled("@storyshelf/core", from);
    if (core !== undefined) copies.add(core.dir);
  }
  return copies.size <= 1
    ? { status: "pass", message: "One copy of @storyshelf/core is installed" }
    : {
        status: "fail",
        message: `More than one copy of @storyshelf/core is installed: ${[...copies].toSorted().join(", ")}`,
      };
}

/** Whether the project itself names `playwright-core` (Docker installs do not). */
function pinsPlaywright(project: InstalledManifest): boolean {
  return [project.dependencies, project.devDependencies].some(
    (field) => field?.["playwright-core"] !== undefined,
  );
}

/**
 * A warning when the project's `playwright-core` is not the one `@storyshelf/runner` resolves, since
 * `playwright-core install` would then fetch the wrong browser revision. Nothing when they match,
 * when the project does not pin `playwright-core`, or when either is not installed.
 */
export function playwrightPinCheck(projectDir: string, project: InstalledManifest): Check[] {
  const runner = pinsPlaywright(project)
    ? findInstalled("@storyshelf/runner", projectDir)
    : undefined;
  const pinned = runner && findInstalled("playwright-core", projectDir);
  const used = runner && findInstalled("playwright-core", runner.dir);
  const pinnedVersion = pinned?.manifest.version;
  const usedVersion = used?.manifest.version;
  if (pinnedVersion === undefined || usedVersion === undefined || pinnedVersion === usedVersion) {
    return [];
  }
  return [
    {
      status: "warn",
      message: `playwright-core ${pinnedVersion} in the project differs from ${usedVersion}, the one @storyshelf/runner uses: the browser install would fetch the wrong revision. Set playwright-core to ${usedVersion} in package.json, install, then run npx playwright-core install chromium.`,
    },
  ];
}

/**
 * The checks that need only the installed packages, run before the instance module is imported: every
 * `@storyshelf/*` package the project names is installed, they share one version and one core, and
 * each one's peers are installed in range. A project with no `package.json`, or none of them, has
 * nothing to check.
 */
export function peerChecks(projectDir: string): Check[] {
  const project = readManifest(join(projectDir, "package.json"));
  const names = project === undefined ? [] : declaredOwn(project);
  const found = names.map((name) => ({ name, installed: findInstalled(name, projectDir) }));
  const present = found.flatMap(({ installed }) => (installed === undefined ? [] : [installed]));
  const missing: Check[] = found
    .filter(({ installed }) => installed === undefined)
    .map(({ name }) => ({
      status: "fail",
      message: `${name} is declared in package.json but not installed. Run your package manager's install.`,
    }));
  if (present.length === 0) return missing;
  return [
    ...missing,
    skewCheck(present),
    coreCopyCheck(projectDir, present),
    ...present.flatMap((installed) => peersOf(installed)),
    ...(project === undefined ? [] : playwrightPinCheck(projectDir, project)),
  ];
}
