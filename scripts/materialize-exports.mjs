#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Make each public package's manifest ship only what the tarball holds (#1265).
 *
 * In the repo, a library's `exports` carry a `source` condition that points at `./src/...` (dev,
 * editor and tsc resolve workspace imports to TypeScript). The tarball omits `src/`, and npm does
 * not apply `publishConfig.exports`, so the published manifest used to keep those dangling
 * conditions. This writes the dist-only `publishConfig.exports` over `exports` (same keys, only the
 * conditions change) and drops it from `publishConfig`.
 *
 * Repo files keep their `source` conditions: run this only on a CI working tree or a scratch copy
 * (the release action and `packed-install-smoke.mjs` do; the latter restores the manifests).
 *
 * Usage: node scripts/materialize-exports.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPublicPackageDirs, packagesDir } from "./publish-order.mjs";

/** The export keys of a map, sorted and joined. */
const keysOf = (map) => Object.keys(map).toSorted().join(",");

/**
 * The manifest with `publishConfig.exports` applied, or `null` when it has none.
 *
 * @param {Record<string, any>} pkg Parsed package.json.
 * @returns {Record<string, any> | null} The new manifest, or null when nothing changes.
 */
export function materializeExports(pkg) {
  const dist = pkg.publishConfig?.exports;
  if (!dist) {
    return null;
  }
  const { exports: _unused, ...publishConfig } = pkg.publishConfig;
  if (keysOf(dist) !== keysOf(pkg.exports ?? {})) {
    throw new Error(`${pkg.name}: publishConfig.exports must have the same keys as exports`);
  }
  return { ...pkg, exports: dist, publishConfig };
}

if (import.meta.main) {
  for (const dir of getPublicPackageDirs()) {
    const file = join(packagesDir, dir, "package.json");
    const next = materializeExports(JSON.parse(readFileSync(file, "utf8")));
    if (next) {
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`materialized exports of ${dir}`);
    }
  }
}
