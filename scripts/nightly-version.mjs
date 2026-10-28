#!/usr/bin/env node
/** Stamp public npm packages with the UTC date of the scheduled workflow run. */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** A daily version is stable across retries of the same scheduled run. */
export function nightlyVersion(createdAt) {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(createdAt)) throw new Error("Expected an ISO run creation time");
  const date = new Date(createdAt);
  if (Number.isNaN(date.valueOf())) throw new Error("Invalid run creation time");
  return `0.0.0-${date.toISOString().slice(0, 10).replaceAll("-", "")}01`;
}

/** Rewrite only public package versions in a disposable publishing checkout. */
export function stampNightlyPackages(packagesDir, version) {
  if (!/^0\.0\.0-\d{10}$/u.test(version)) throw new Error("Invalid nightly version");
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
  const createdAt = process.argv[2];
  if (!createdAt) throw new Error("Usage: node scripts/nightly-version.mjs <run-created-at>");
  const version = nightlyVersion(createdAt);
  const count = stampNightlyPackages(join(import.meta.dirname, "..", "packages"), version);
  console.log(`Stamped ${count} packages: ${version}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  }
}
