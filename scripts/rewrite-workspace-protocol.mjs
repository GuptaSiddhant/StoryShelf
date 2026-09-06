#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Rewrite `workspace:*` requirements to caret ranges of the current fixed
 * version. Shared by the npm and JSR publish paths — neither registry can
 * record the workspace protocol in a published manifest.
 *
 * Repo files keep `workspace:*`; run this only on a CI working tree where
 * dirty state is tolerated (publish jobs use --allow-dirty equivalents).
 * Local node_modules symlinks keep resolving after the rewrite.
 *
 * Usage:
 *   node scripts/rewrite-workspace-protocol.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { dirname } = import.meta;
const packagesDir = join(dirname, "..", "packages");

let rewrote = 0;
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const filePath = join(packagesDir, entry.name, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    continue;
  }
  if (pkg.private || !pkg.dependencies) {
    continue;
  }
  let changed = false;
  for (const dep of Object.keys(pkg.dependencies)) {
    if (dep.startsWith("@storyshelf/") && pkg.dependencies[dep] === "workspace:*") {
      pkg.dependencies[dep] = `^${pkg.version}`;
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`rewrote ${entry.name}`);
    rewrote += 1;
  }
}
console.log(`workspace protocol rewrite complete (${rewrote} packages)`);
