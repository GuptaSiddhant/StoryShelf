#!/usr/bin/env node
/** Give public packages the same commit-based version pkg.pr.new uses when packing. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function previewVersion(sha) {
  if (!/^[\da-f]{40}$/iu.test(sha)) throw new Error("Expected a full Git commit SHA");
  return `0.0.0-preview-${sha.slice(0, 7).toLowerCase()}`;
}

/** Run only in a disposable publishing checkout, after dependency installation. */
export function stampPreviewPackages(packagesDir, version) {
  if (!/^0\.0\.0-preview-[\da-f]{7}$/u.test(version)) throw new Error("Invalid preview version");
  let count = 0;
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(packagesDir, entry.name, "package.json");
    let source;
    try {
      source = readFileSync(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const pkg = JSON.parse(source);
    if (pkg.private === true || !pkg.name) continue;
    if (typeof pkg.version !== "string") throw new Error(`Missing version in ${path}`);
    pkg.version = version;
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    count += 1;
  }
  if (count === 0) throw new Error("No public packages found");
  return count;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = previewVersion(process.argv[2] ?? "");
  const count = stampPreviewPackages(join(import.meta.dirname, "..", "packages"), version);
  console.log(`Stamped ${count} packages: ${version}`);
}
