#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { dirname } = import.meta;
const root = join(dirname, "..");
const packagesDir = join(root, "packages");

/**
 * Get names of all public packages in the monorepo.
 * A package is public if it has publishConfig.access === "public" and is not private.
 *
 * @returns {string[]} Array of package names.
 */
export function getPublicPackageNames() {
  const names = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(packagesDir, entry.name, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const isPrivate = pkg.private === true;
      const access = pkg.publishConfig?.access;
      if (isPrivate) continue;
      if (access && access !== "public") continue;
      if (!pkg.name) continue;
      names.push(pkg.name);
    } catch {
      // Ignore missing/invalid package.json
    }
  }
  return names;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const name of getPublicPackageNames()) {
    console.log(name);
  }
}
