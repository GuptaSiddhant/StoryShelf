#!/usr/bin/env node
// oxlint-disable max-statements no-console
/**
 * Prepare a stable release (ADR 0043): `nub run release:prepare`.
 *
 * Versions the pending Changesets on a new branch `release/v<version>`: every package moves to one
 * version, the root CHANGELOG.md gets its section, the consumed changesets are deleted, and the
 * result is committed as `chore(release): v<version>`. It pushes nothing and tags nothing. Open a
 * pull request from the branch; merging it to `main` is what publishes (`release.yml`).
 *
 * Fails when there are no pending changesets or the working tree is not clean.
 *
 * Usage:
 *   nub run release:prepare             # branch + commit
 *   nub run release:dry                 # version the working tree and check packaging; no branch
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function log(message) {
  console.log(`[release] ${message}`);
}

function fail(message) {
  console.error(`[release:error] ${message}`);
  process.exit(1);
}

function run(command) {
  const result = spawnSync(command, { shell: true, stdio: "inherit", cwd: root });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command) {
  return execSync(command, { encoding: "utf8", cwd: root }).trim();
}

function coreVersion() {
  return JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8")).version;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: nub run release:prepare   (or: nub run release:dry for a dry run)");
  process.exit(0);
}
const unknown = args.filter((arg) => arg !== "--dry-run");
if (unknown.length > 0) {
  fail(`unknown argument: ${unknown.join(" ")} (the version comes from the pending changesets)`);
}

const dirty = capture("git status --porcelain");
if (dirty) {
  console.error(dirty);
  fail("working tree not clean: commit or stash changes first");
}

const previous = coreVersion();
log(`current fixed version: ${previous}`);
log("versioning from the pending changesets");
run("node scripts/version-packages.mjs"); // fails clearly when none are pending

const version = coreVersion();
run(`node scripts/release-validate.mjs v${version}`); // one shared version

log("packaging check: nub publish -r --dry-run");
run(process.env["RELEASE_PUBLISH_CMD"] ?? "nub publish -r --dry-run --no-git-checks");

if (dryRun) {
  log(`dry run: ${previous} → ${version} in the working tree, nothing committed`);
  log("undo with: git checkout -- . && git clean -fd .changeset packages");
  process.exit(0);
}

const branch = `release/v${version}`;
run(`git switch -c ${branch}`);
run("git add packages .changeset CHANGELOG.md");
run(`git commit -m "chore(release): v${version}"`);
log(`${previous} → ${version} committed on ${branch}`);
console.log(`
Next: git push -u origin ${branch}
      open a pull request titled "chore(release): v${version}" into main.
      Merging it publishes ${version} to npm (latest), tags v${version}
      and creates the GitHub Release (release.yml).`);
