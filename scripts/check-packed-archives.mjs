#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Fail when a packed tarball is not what a consumer needs (#1265, from the 0.14.0 audit):
 *
 *  - an `exports` or `bin` target is not in the tarball;
 *  - a `source` export condition ships (it points at `src/`, which is never packed);
 *  - a `types` target is missing;
 *  - a source map ships (the maps point at `src/`).
 *
 * Usage: node scripts/check-packed-archives.mjs <tarball.tgz>...
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";

/** A target is a file path inside the package; skip bare specifiers and `null` (a blocked subpath). */
const isFileTarget = (value) => typeof value === "string" && value.startsWith("./");

/**
 * Every file target of an `exports` value, with the condition path that leads to it.
 *
 * @param {unknown} value A string, a condition map or a null.
 * @param {string} where Export key and conditions so far.
 * @returns {{ where: string, target: string }[]} Targets.
 */
export function exportTargets(value, where) {
  if (typeof value === "string") {
    return isFileTarget(value) ? [{ where, target: value }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => exportTargets(entry, where));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      exportTargets(entry, key.startsWith(".") ? key : `${where} ${key}`),
    );
  }
  return [];
}

/** Whether any condition named `source` appears in an `exports` value. */
export function hasSourceCondition(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, entry]) => key === "source" || hasSourceCondition(entry),
  );
}

/**
 * Problems of one packed package.
 *
 * @param {Record<string, any>} manifest The packed package.json.
 * @param {Iterable<string>} files Paths in the tarball, relative to the package root.
 * @returns {string[]} One line per problem; empty when the archive is fine.
 */
export function checkArchive(manifest, files) {
  const present = new Set([...files].map((file) => normalize(file)));
  const has = (target) => present.has(normalize(target));
  const problems = [];
  if (hasSourceCondition(manifest.exports)) {
    problems.push('exports carry a "source" condition (it points at src/, which is not packed)');
  }
  for (const { where, target } of exportTargets(manifest.exports, "exports")) {
    if (!has(target)) {
      problems.push(`exports ${where} -> ${target} is not in the tarball`);
    }
  }
  const bins =
    typeof manifest.bin === "string" ? { [manifest.name]: manifest.bin } : (manifest.bin ?? {});
  for (const [name, target] of Object.entries(bins)) {
    if (!has(target)) {
      problems.push(`bin ${name} -> ${target} is not in the tarball`);
    }
  }
  for (const field of ["main", "module", "types"]) {
    if (isFileTarget(manifest[field]) && !has(manifest[field])) {
      problems.push(`${field} -> ${manifest[field]} is not in the tarball`);
    }
  }
  const maps = [...present].filter((file) => file.endsWith(".map")).toSorted();
  if (maps.length > 0) {
    problems.push(
      `${maps.length} source maps ship, e.g. ${maps[0]} (they point at src/, which is not packed)`,
    );
  }
  return problems;
}

/** Unpack a tarball into a fresh directory and read its manifest and file list. */
function readTarball(tarball) {
  const dir = mkdtempSync(join(tmpdir(), "packed-archive-"));
  try {
    const result = spawnSync("tar", ["-xzf", tarball, "-C", dir], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`cannot unpack ${tarball}: ${result.stderr}`);
    }
    const listing = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8", maxBuffer: 1 << 26 });
    const files = listing.stdout
      .split("\n")
      .filter((line) => line.startsWith("package/") && !line.endsWith("/"))
      .map((line) => line.slice("package/".length));
    const manifest = JSON.parse(readFileSync(join(dir, "package/package.json"), "utf8"));
    return { manifest, files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Check packed tarballs; prints each problem. Returns the number of problems.
 *
 * @param {string[]} tarballs Paths of `npm pack` tarballs.
 * @returns {number} Problem count.
 */
export function checkTarballs(tarballs) {
  let count = 0;
  for (const tarball of tarballs) {
    const { manifest, files } = readTarball(tarball);
    const problems = checkArchive(manifest, files);
    count += problems.length;
    for (const problem of problems) {
      console.error(`::error::${manifest.name}@${manifest.version}: ${problem}`);
    }
    console.log(
      `${manifest.name}@${manifest.version}: ${problems.length === 0 ? "ok" : `${problems.length} problem(s)`}`,
    );
  }
  return count;
}

if (import.meta.main) {
  const tarballs = process.argv.slice(2);
  if (tarballs.length === 0) {
    console.error("usage: node scripts/check-packed-archives.mjs <tarball.tgz>...");
    process.exit(2);
  }
  process.exit(checkTarballs(tarballs) === 0 ? 0 : 1);
}
