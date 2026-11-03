#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Versioning for the Changesets release flow (ADR 0043).
 *
 *   node scripts/version-packages.mjs             stable: consume the pending changesets, bump
 *                                                 every package to one version, write the root
 *                                                 CHANGELOG.md section, keep deno.json in step
 *   node scripts/version-packages.mjs --pending   print the number of pending changesets (emits
 *                                                 `pending=<n>`); changes nothing
 *   node scripts/version-packages.mjs --snapshot  CI `next` build: a throwaway version
 *                                                 `<next>-next-<sha>` in the working tree, never
 *                                                 committed (emits `version=<v>`)
 *
 * Stable and snapshot runs both need at least one pending changeset and fail clearly without one.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listPending, mergeChangelog, renderEntries } from "./changeset-lib.mjs";

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

function changeset(...args) {
  const result = spawnSync(join(root, "node_modules", ".bin", "changeset"), args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`changeset ${args.join(" ")} failed`);
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

/** Package directory names under `packages/`. */
function packageDirs() {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** Write `version` into one `deno.json`; a package without one is not published to JSR. */
function setDenoVersion(dir, version) {
  const file = join(packagesDir, dir, "deno.json");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (!/"version":\s*"[^"]*"/u.test(text)) {
    fail(`${file}: no "version" field to update`);
  }
  writeFileSync(file, text.replace(/"version":\s*"[^"]*"/u, `"version": "${version}"`));
}

/** The commit hash Changesets puts in a snapshot version is the full one; the issue wants a short one. */
const SNAPSHOT_SUFFIX = /(?<head>-next-)(?<sha>[0-9a-f]{40})$/u;

/** Rewrite the `version` of every package.json from `from` to `to` (only that field). */
function renameVersion(from, to) {
  for (const dir of packageDirs()) {
    const file = join(packagesDir, dir, "package.json");
    const text = readFileSync(file, "utf8");
    if (text.includes(`"version": "${from}"`)) {
      writeFileSync(file, text.replace(`"version": "${from}"`, `"version": "${to}"`));
    }
  }
}

/** Shorten a snapshot version's commit hash to 7 characters across the workspace; returns the new version. */
function shortenSnapshot(version) {
  const match = SNAPSHOT_SUFFIX.exec(version);
  if (!match?.groups) {
    return version;
  }
  const short = version.replace(
    SNAPSHOT_SUFFIX,
    `${match.groups.head}${match.groups.sha.slice(0, 7)}`,
  );
  renameVersion(version, short);
  return short;
}

/** Make every `deno.json` carry the version `changeset version` wrote to its package.json. */
function syncDenoVersions(version) {
  for (const dir of packageDirs()) {
    setDenoVersion(dir, version);
  }
}

function requirePending() {
  const pending = listPending(changesetDir);
  if (pending.length === 0) {
    fail("no pending changesets: add one with `nubx changeset` before versioning");
  }
  return pending;
}

const mode = process.argv[2];
if (mode === "--pending") {
  emit("pending", listPending(changesetDir).length);
} else if (mode === "--snapshot") {
  requirePending();
  changeset("version", "--snapshot", "next");
  const version = shortenSnapshot(sharedVersion());
  syncDenoVersions(version);
  emit("version", version);
} else if (mode === undefined) {
  const entries = renderEntries(requirePending());
  changeset("version");
  const version = sharedVersion();
  syncDenoVersions(version);
  const file = join(root, "CHANGELOG.md");
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(file, mergeChangelog(readFileSync(file, "utf8"), { version, date, entries }));
  emit("version", version);
} else {
  fail(`unknown option ${mode} (want --pending or --snapshot, or none for a stable release)`);
}
