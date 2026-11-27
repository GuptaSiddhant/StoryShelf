#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * The generated version and peer manifest (#1332): one JSON file, `config/version-manifest.json`,
 * with every published workspace package's version and its peer dependencies (range, whether
 * optional, and the subpaths that need it, from `package.json#storyshelf.peerSubpaths`).
 *
 * `create-storyshelf` writes its pins from it, and `storyshelf-server` takes the missing-peer hint
 * and the `doctor` checks from it, so no range is copied by hand. `@storyshelf/*` peers are written
 * as the package's own version (`workspace:*` is rewritten at publish, so the manifest does the same).
 *
 *   node scripts/version-manifest.mjs           write config/version-manifest.json
 *   node scripts/version-manifest.mjs --check   exit 1 when the file is stale
 *
 * `version-packages.mjs` regenerates it after a bump; a test fails on drift.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
export const MANIFEST_PATH = join(ROOT, "config", "version-manifest.json");

/** Concrete range of a peer: `workspace:*` becomes the package's version. */
function peerRange(range, version) {
  return range === "workspace:*" ? version : range;
}

function peersOf(pkg) {
  const subpaths = pkg.storyshelf?.peerSubpaths ?? {};
  const peers = {};
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {}).toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    peers[name] = {
      range: peerRange(range, pkg.version),
      optional: pkg.peerDependenciesMeta?.[name]?.optional === true,
      ...(subpaths[name] ? { subpaths: subpaths[name] } : {}),
    };
  }
  return peers;
}

/**
 * The dependencies a package lists in `package.json#storyshelf.exposedDependencies`, at their pinned
 * version: a project that installs the package pins them too, so their binaries resolve from the project.
 */
function exposedOf(pkg) {
  const exposed = {};
  for (const name of pkg.storyshelf?.exposedDependencies ?? []) {
    exposed[name] = pkg.dependencies?.[name];
  }
  return Object.keys(exposed).length > 0 ? { exposed } : {};
}

/** The manifest of the published packages under `root`, keyed by package name. */
export function buildVersionManifest(root = ROOT) {
  const packages = {};
  const packagesDir = join(root, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(packagesDir, entry.name, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (pkg.private === true || !pkg.name) continue;
    packages[pkg.name] = { version: pkg.version, peers: peersOf(pkg), ...exposedOf(pkg) };
  }
  return {
    packages: Object.fromEntries(
      Object.entries(packages).toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

/** Short string arrays on one line, as oxfmt formats them (the file must be stable under `nub run fmt`). */
function inlineShortArrays(text) {
  return text.replaceAll(
    /^(?<head>\s*"[^"]+": )\[\n(?<items>(?:\s+"[^"\n]*",?\n)+)\s*\](?<tail>,?)$/gmu,
    (whole, head, items, tail) => {
      const line = `${head}[${items
        .trim()
        .split(/,?\n\s*/u)
        .join(", ")}]${tail}`;
      return line.length <= 100 ? line : whole;
    },
  );
}

/** The manifest as the file's text. */
export function renderVersionManifest(root = ROOT) {
  return `${inlineShortArrays(JSON.stringify(buildVersionManifest(root), null, 2))}\n`;
}

/** Write the manifest file; returns whether it changed. */
export function writeVersionManifest(root = ROOT) {
  const next = renderVersionManifest(root);
  let current = "";
  try {
    current = readFileSync(MANIFEST_PATH, "utf8");
  } catch {
    // first run
  }
  if (current === next) return false;
  writeFileSync(MANIFEST_PATH, next);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(MANIFEST_PATH, "utf8");
    } catch {
      // missing counts as stale
    }
    if (current !== renderVersionManifest()) {
      console.error("config/version-manifest.json is stale: run `nub run manifest`");
      process.exit(1);
    }
  } else {
    console.log(writeVersionManifest() ? "wrote config/version-manifest.json" : "up to date");
  }
}
