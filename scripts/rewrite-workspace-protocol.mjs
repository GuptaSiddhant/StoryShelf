#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Rewrite `workspace:*` and `catalog:` version requirements to concrete
 * semver before publish. Neither npm nor JSR can record the workspace
 * protocol or pnpm-style catalog references in a published manifest.
 *
 * - `workspace:*` (for `@storyshelf/*` deps) → the package's own version.
 * - `catalog:` → the resolved version from the root `workspaces.catalog`.
 *
 * Repo files keep `workspace:*`/`catalog:`; run this only on a CI working
 * tree where dirty state is tolerated (publish jobs use --allow-dirty).
 * Local node_modules symlinks keep resolving after the rewrite.
 *
 * Usage:
 *   node scripts/rewrite-workspace-protocol.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { dirname } = import.meta;
const ROOT_DIR = join(dirname, "..");
const PACKAGES_DIR = join(ROOT_DIR, "packages");
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

const rootPkg = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
const catalog = rootPkg?.workspaces?.catalog ?? {};

let rewrote = 0;
for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const filePath = join(PACKAGES_DIR, entry.name, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    continue;
  }
  if (pkg.private === true || !pkg.name) {
    continue;
  }
  let changed = false;
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) {
      continue;
    }
    for (const [dep, version] of Object.entries(deps)) {
      if (dep.startsWith("@storyshelf/") && version === "workspace:*") {
        deps[dep] = `${pkg.version}`;
        changed = true;
      } else if (version === "catalog:" && catalog[dep]) {
        deps[dep] = catalog[dep];
        changed = true;
      }
    }
  }
  if (changed) {
    writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`rewrote ${entry.name}`);
    rewrote += 1;
  }
}
console.log(`workspace/catalog rewrite complete (${rewrote} packages)`);
