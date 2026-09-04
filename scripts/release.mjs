#!/usr/bin/env node
// oxlint-disable max-statements no-console
/**
 * Release helper — guarantees fixed-version bump + checks.
 * Bumps every workspace package to the same version, then commits and
 * tags `v<version>` (`nub version` only handles a single manifest, so the
 * workspace bump lives here).
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
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
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
for (let index = 0; index < argsWithoutDry.length; index += 1) {
  const arg = argsWithoutDry[index];
  if (arg === "--preid") {
    preid = argsWithoutDry[index + 1];
    if (!preid) {
      error("--preid requires a value");
      process.exit(1);
    }
    index += 1;
  } else if (arg.startsWith("--")) {
    error(`unknown flag: ${arg}`);
    printHelp();
    process.exit(1);
  } else if (!bump) {
    bump = arg;
  } else {
    error(`unexpected argument: ${arg}`);
    printHelp();
    process.exit(1);
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
    if (!e.isDirectory()) {
      continue;
    }
    const pkgPath = join(packagesDir, e.name, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.private) {
        continue;
      }
      versions.push({ name: pkg.name ?? e.name, version: pkg.version, dir: e.name });
    } catch {
      // Ignore missing or invalid package.json
    }
  }
  return versions;
}

// Minimal semver bump logic (no dependency). `nub version` only bumps a single
// manifest and the private root has no version field, so fixed-version bumps
// across the workspace are done here instead.
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}`;
}

function bumpPreid(pre, preid) {
  const parts = pre.split(".");
  const last = parts[parts.length - 1];
  if (preid && parts[0] !== preid) {
    return `${preid}.0`;
  }
  if (/^\d+$/.test(last ?? "")) {
    return [...parts.slice(0, -1), String(Number(last) + 1)].join(".");
  }
  return `${pre}.0`;
}

function resolveBumpVersion(current, bumpKind, preid) {
  if (bumpKind === "from-git") {
    const tag = capture("git describe --tags --abbrev=0").trim();
    const version = tag.startsWith("v") ? tag.slice(1) : tag;
    if (!parseVersion(version)) {
      error(`cannot resolve version from git tag: ${tag}`);
      process.exit(1);
    }
    return version;
  }
  if (parseVersion(bumpKind)) {
    return bumpKind;
  }
  const v = parseVersion(current);
  if (!v) {
    error(`current version is not valid semver: ${current}`);
    process.exit(1);
  }
  const pre = preid ? `${preid}.0` : "0";
  switch (bumpKind) {
    case "major":
      return formatVersion({ major: v.major + 1, minor: 0, patch: 0, pre: null });
    case "minor":
      return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0, pre: null });
    case "patch":
      return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1, pre: null });
    case "premajor":
      return formatVersion({ major: v.major + 1, minor: 0, patch: 0, pre });
    case "preminor":
      return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0, pre });
    case "prepatch":
      return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1, pre });
    case "prerelease":
      if (!v.pre) {
        return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1, pre });
      }
      return formatVersion({ ...v, pre: bumpPreid(v.pre, preid) });
    default:
      error(`unknown bump: ${bumpKind} (want patch|minor|major|premajor|preminor|prepatch|prerelease|from-git|0.2.0)`);
      process.exit(1);
  }
}

// Byte-precise version rewrite: replaces exactly one `"version": "<old>"`
// line so file formatting is untouched. Returns written paths.
function writeWorkspaceVersions(packages, oldVersion, newVersion) {
  const packagesDir = new URL("../packages/", import.meta.url).pathname;
  const written = [];
  const needle = `"version": "${oldVersion}"`;
  for (const { dir } of packages) {
    for (const file of ["package.json", "deno.json"]) {
      const filePath = join(packagesDir, dir, file);
      let content;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        if (file === "deno.json") {
          continue;
        }
        error(`missing ${filePath}`);
        process.exit(1);
      }
      const count = content.split(needle).length - 1;
      if (count !== 1) {
        error(`expected 1 version field in ${filePath}, found ${count}`);
        process.exit(1);
      }
      writeFileSync(filePath, content.replace(needle, `"version": "${newVersion}"`));
      written.push(`packages/${dir}/${file}`);
    }
  }
  return written;
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

// 4. Bump the fixed version across the workspace, then commit and tag.
// Lightweight tag `v<version>` with message `v<version>`, same shape as ever.
const targetVersion = resolveBumpVersion(uniqBefore[0], bump, preid);
log(`bumping fixed version: ${uniqBefore[0]} → ${targetVersion}`);
const bumpedFiles = writeWorkspaceVersions(before, uniqBefore[0], targetVersion);
if (dryRun) {
  log("dry-run: skipping commit/tag (versions bumped in working tree only)");
} else {
  run(`git add ${bumpedFiles.join(" ")}`);
  run(`git commit -m "v${targetVersion}"`);
  run(`git tag v${targetVersion}`);
}

// 5. Guarantee: all packages now fixed at new version
const after = getPackageVersions();
const uniqAfter = [...new Set(after.map((v) => v.version))];
if (uniqAfter.length !== 1) {
  error(`post-bump versions not fixed: ${uniqAfter.join(", ")}`);
  console.error(after.map((v) => `  ${v.name}: ${v.version}`).join("\n"));
  process.exit(1);
}
const newVersion = uniqAfter.at(0);
log(`new fixed version: ${newVersion}`);

// 5.5 deno.json versions were bumped alongside package.json above (tsdown
// regenerates them on build too).

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
  log(`reset with: git checkout -- packages/*/package.json packages/*/deno.json  # if needed`);
} else {
  const tag = `v${newVersion}`;
  log(`bump complete: ${uniqBefore[0]} → ${newVersion} (commit + tag ${tag})`);
  // Verify tag exists
  try {
    const tags = capture("git tag --points-at HEAD");
    if (!tags.split("\n").includes(tag)) {
      error(`expected tag ${tag} not found at HEAD — bump step may not have tagged`);
    }
  } catch {
    error("failed to verify git tag");
  }
  console.log("");
  console.log(`Next: git push --follow-tags`);
  console.log(`  → triggers .github/workflows/release.yml for trusted publish + GitHub Release`);
  if (newVersion.includes("-")) {
    log(`pre-release detected — will publish with npm dist-tag 'next'`);
  }
}
