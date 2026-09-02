#!/usr/bin/env node
/**
 * Release helper — guarantees fixed-version bump + checks.
 * Wraps `nub version` which commits and tags `v<version>`.
 *
 * Usage:
 *   nub ./scripts/release.mjs patch
 *   nub ./scripts/release.mjs minor
 *   nub ./scripts/release.mjs major
 *   nub ./scripts/release.mjs prerelease --preid rc
 *   nub ./scripts/release.mjs 0.2.0
 *   nub ./scripts/release.mjs 0.2.0-rc.1
 *   nub ./scripts/release.mjs patch --dry-run
 *
 * Does NOT push — you run `git push --follow-tags` manually after review.
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DRY_RUN_FLAG = "--dry-run";
const HELP_FLAG = "--help";

function log(msg) {
  console.log(`[release] ${msg}`);
}
function error(msg) {
  console.error(`[release:error] ${msg}`);
}
function run(cmd, opts = {}) {
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}
function capture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function printHelp() {
  console.log(`
Usage: nub ./scripts/release.mjs <bump> [options]

Bump via nub version with fixed-version guarantee.

  bump                       patch|minor|major|premajor|preminor|prepatch|prerelease|from-git|0.2.0
  --preid <id>               prerelease identifier (rc, beta, alpha) — passed to nub version
  --dry-run                  run checks but do not commit/tag (passes --no-git-tag-version to nub version)
  --help                     show this help

Examples:
  nub ./scripts/release.mjs patch
  nub ./scripts/release.mjs minor
  nub ./scripts/release.mjs prerelease --preid rc
  nub ./scripts/release.mjs 0.2.0
  nub ./scripts/release.mjs patch --dry-run

After a successful bump:
  git push --follow-tags
  → triggers .github/workflows/release.yml (tag v* → trusted publish + GitHub Release)
`);
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes(HELP_FLAG) || rawArgs.includes("-h")) {
  printHelp();
  process.exit(0);
}

const dryRun = rawArgs.includes(DRY_RUN_FLAG);
const argsWithoutDry = rawArgs.filter((a) => a !== DRY_RUN_FLAG);

if (argsWithoutDry.length === 0) {
  error("missing bump argument: patch|minor|major|prerelease|0.2.0");
  printHelp();
  process.exit(1);
}

// First non-flag is bump
let bump = null;
let preid = null;
const nubVersionArgs = [];
for (let i = 0; i < argsWithoutDry.length; i++) {
  const arg = argsWithoutDry[i];
  if (arg === "--preid") {
    preid = argsWithoutDry[i + 1];
    if (!preid) {
      error("--preid requires a value");
      process.exit(1);
    }
    nubVersionArgs.push("--preid", preid);
    i++;
  } else if (arg.startsWith("--")) {
    nubVersionArgs.push(arg);
  } else if (!bump) {
    bump = arg;
    nubVersionArgs.push(arg);
  } else {
    nubVersionArgs.push(arg);
  }
}

if (!bump) {
  error("unable to determine bump argument");
  process.exit(1);
}

// 1. Guard: clean working tree
try {
  const status = capture("git status --porcelain");
  if (status) {
    error("working tree not clean — commit or stash changes first");
    console.error(status);
    process.exit(1);
  }
} catch {
  error("failed to check git status");
  process.exit(1);
}

// 2. Pre-check: all workspace versions are currently fixed
function getPackageVersions() {
  const packagesDir = new URL("../packages/", import.meta.url).pathname;
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const versions = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pkgPath = join(packagesDir, e.name, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.private) continue;
      versions.push({ name: pkg.name ?? e.name, version: pkg.version, dir: e.name });
    } catch {}
  }
  return versions;
}

const before = getPackageVersions();
const uniqBefore = [...new Set(before.map((v) => v.version))];
if (uniqBefore.length !== 1) {
  error(`pre-bump versions not fixed: ${uniqBefore.join(", ")}`);
  console.error(before.map((v) => `  ${v.name}: ${v.version}`).join("\n"));
  process.exit(1);
}
log(`current fixed version: ${uniqBefore[0]}`);

// 3. Run checks (verify) before bump
log("running checks: turbo verify --filter='./packages/*'");
try {
  run("nubx turbo verify --filter='./packages/*' --force");
} catch {
  error("verify failed — aborting bump");
  process.exit(1);
}

// 4. Run nub version
const versionCmd = ["nub", "version", ...nubVersionArgs];
if (dryRun) versionCmd.push("--no-git-tag-version");
log(`running: ${versionCmd.join(" ")}${dryRun ? " (dry-run, no commit/tag)" : ""}`);
run(versionCmd.join(" "));

// 5. Guarantee: all packages now fixed at new version
const after = getPackageVersions();
const uniqAfter = [...new Set(after.map((v) => v.version))];
if (uniqAfter.length !== 1) {
  error(`post-bump versions not fixed: ${uniqAfter.join(", ")}`);
  console.error(after.map((v) => `  ${v.name}: ${v.version}`).join("\n"));
  process.exit(1);
}
const newVersion = uniqAfter[0];
log(`new fixed version: ${newVersion}`);

// 6. Dry-run publish check
log("dry-run publish check: nub publish -r --dry-run --provenance");
try {
  run("nub publish -r --dry-run --provenance --no-git-checks");
} catch {
  error("publish dry-run failed");
  if (!dryRun) {
    error("bump committed but publish dry-run failed — inspect and fix before pushing tag");
    error(`to undo: git reset --hard HEAD~1 && git tag -d v${newVersion}`);
  }
  process.exit(1);
}

if (dryRun) {
  log("dry-run complete — versions bumped in working tree but not committed/tagged");
  log(`reset with: git checkout -- packages/*/package.json nub.lock  # if needed`);
} else {
  const tag = `v${newVersion}`;
  log(`bump complete: ${uniqBefore[0]} → ${newVersion} (commit + tag ${tag})`);
  // verify tag exists
  try {
    const tags = capture("git tag --points-at HEAD");
    if (!tags.split("\n").includes(tag)) {
      error(`expected tag ${tag} not found at HEAD — nub version may not have tagged`);
    }
  } catch {}
  console.log("");
  console.log(`Next: git push --follow-tags`);
  console.log(`  → triggers .github/workflows/release.yml for trusted publish + GitHub Release`);
  if (newVersion.includes("-")) {
    log(`pre-release detected — will publish with npm dist-tag 'next'`);
  }
}
