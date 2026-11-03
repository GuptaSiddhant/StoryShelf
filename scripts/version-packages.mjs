#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Versioning for the Changesets release flow (ADR 0043), done here and not by the Changesets CLI.
 *
 *   node scripts/version-packages.mjs             stable: consume the pending changesets, bump
 *                                                 every package to one version, write the root
 *                                                 CHANGELOG.md section
 *   node scripts/version-packages.mjs --pending   print the number of pending changesets (emits
 *                                                 `pending=<n>`); changes nothing
 *   node scripts/version-packages.mjs --snapshot  CI `next` build: a throwaway version
 *                                                 `<next>-next-<sha>` in the working tree, never
 *                                                 committed (emits `version=<v>`)
 *
 * The next version is the shared version raised by the largest bump over all pending changesets
 * (the packages share one version). Stable and snapshot runs both need at least one pending
 * changeset and fail clearly without one, and on a changeset that names an unknown package.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  bumpVersion,
  highestBump,
  listPending,
  mergeChangelog,
  renderEntries,
  unknownReleases,
} from "./changeset-lib.mjs";

const root = join(import.meta.dirname, "..");
const changesetDir = join(root, ".changeset");
const packagesDir = join(root, "packages");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function emit(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

/** The one version every published package must share. */
function sharedVersion() {
  const versions = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pkg = JSON.parse(readFileSync(join(packagesDir, entry.name, "package.json"), "utf8"));
    if (!pkg.private) {
      versions.set(pkg.version, [...(versions.get(pkg.version) ?? []), pkg.name]);
    }
  }
  if (versions.size !== 1) {
    fail(`packages are not at one version: ${[...versions.keys()].join(", ")}`);
  }
  return [...versions.keys()][0];
}

/** Write `text` to a sibling temp file, then rename it over `file`, so an interruption never leaves a truncated file. */
function writeFileAtomic(file, text) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

/** Package directory names under `packages/`. */
function packageDirs() {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The manifests of the published packages: `{ file, name }`. */
function publishedManifests() {
  return packageDirs()
    .map((dir) => join(packagesDir, dir, "package.json"))
    .map((file) => ({ file, pkg: JSON.parse(readFileSync(file, "utf8")) }))
    .filter(({ pkg }) => !pkg.private)
    .map(({ file, pkg }) => ({ file, name: pkg.name }));
}

const VERSION_LINE = /^(?<head>\s*"version":\s*")[^"]+(?<tail>")/mu;

/** Set the `version` field of every published package.json, touching nothing else in the file. */
function writeVersion(version) {
  for (const { file, name } of publishedManifests()) {
    const text = readFileSync(file, "utf8");
    if (!VERSION_LINE.test(text)) {
      fail(`${name}: no "version" field to update in ${file}`);
    }
    writeFileAtomic(file, text.replace(VERSION_LINE, `$<head>${version}$<tail>`));
  }
}

/** Delete every changeset file (empty ones too): all of them are consumed by a version run. */
function deleteChangesets() {
  for (const name of readdirSync(changesetDir)) {
    if (name.endsWith(".md") && name !== "README.md") {
      unlinkSync(join(changesetDir, name));
    }
  }
}

/** Read the pending changesets, failing clearly on an unreadable file. */
function loadPending() {
  try {
    return listPending(changesetDir);
  } catch (error) {
    return fail(error.message);
  }
}

/** The pending changesets; fails when there is none or one names an unknown package. */
function readPending() {
  const pending = loadPending();
  if (pending.length === 0) {
    fail(
      "no pending changesets: add one with `nub run changeset <patch|minor|major>` before versioning",
    );
  }
  const unknown = unknownReleases(
    pending,
    publishedManifests().map(({ name }) => name),
  );
  if (unknown.length > 0) {
    fail(unknown.join("\n"));
  }
  return pending;
}

/** The pending changesets and the version they lead to. */
function plan() {
  const pending = readPending();
  return { pending, next: bumpVersion(sharedVersion(), highestBump(pending)) };
}

/** The first 7 characters of HEAD's commit hash, for a snapshot version. */
function shortSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail("cannot read HEAD's commit hash (a snapshot version names it)");
  }
  return result.stdout.trim().slice(0, 7);
}

const mode = process.argv[2];
if (mode === "--pending") {
  emit("pending", listPending(changesetDir).length);
} else if (mode === "--snapshot") {
  const version = `${plan().next}-next-${shortSha()}`;
  writeVersion(version);
  deleteChangesets();
  emit("version", version);
} else if (mode === undefined) {
  const { pending, next } = plan();
  const file = join(root, "CHANGELOG.md");
  const date = new Date().toISOString().slice(0, 10);
  const entries = renderEntries(pending);
  writeFileAtomic(
    file,
    mergeChangelog(readFileSync(file, "utf8"), { version: next, date, entries }),
  );
  writeVersion(next);
  deleteChangesets();
  emit("version", next);
} else {
  fail(`unknown option ${mode} (want --pending or --snapshot, or none for a stable release)`);
}
