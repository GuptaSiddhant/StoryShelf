#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Release validation gate — single source of truth for the release workflow.
 * Checks: tag matches the fixed workspace version, all non-private packages
 * share one version, every non-private package declares `engines.node >=24`,
 * Emits `version` and `dist_tag` (stdout + GITHUB_OUTPUT when present).
 *
 * Usage:
 *   node scripts/release-validate.mjs v0.3.1
 *   node scripts/release-validate.mjs "$GITHUB_REF_NAME"
 *   node scripts/release-validate.mjs --tree     # `next` build: no tag, the working tree's version is the truth
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { dirname } = import.meta;
const packagesDir = join(dirname, "..", "packages");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function emit(key, value) {
  console.log(`${key}=${value}`);
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

const arg = process.argv[2];
if (!arg) {
  fail("missing tag argument: node scripts/release-validate.mjs <tag> | --tree");
}

const corePkg = readJson(join(packagesDir, "core", "package.json"));
if (arg === "--tree") {
  // A `next` snapshot is versioned in the working tree and never tagged.
  console.log(`tree pkg=v${corePkg.version}`);
  if (!String(corePkg.version).includes("-next-")) {
    fail(`--tree expects a snapshot version (x.y.z-next-<sha>), found ${corePkg.version}`);
  }
} else {
  console.log(`tag=${arg} pkg=v${corePkg.version}`);
  if (arg !== `v${corePkg.version}`) {
    fail(`Tag ${arg} != packages/core version v${corePkg.version}`);
  }
}

// All non-private packages must share same version.
const versions = new Map();
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  try {
    const pkg = readJson(join(packagesDir, entry.name, "package.json"));
    if (pkg.private || !pkg.version) {
      continue;
    }
    versions.set(pkg.version, [...(versions.get(pkg.version) ?? []), pkg.name ?? entry.name]);
  } catch {
    // Ignore missing or invalid package.json
  }
}
const distinct = [...versions.keys()];
console.log(`distinct versions: ${distinct.join(",")} (count=${distinct.length})`);
if (distinct.length !== 1) {
  const detail = [...versions.entries()].map(([v, names]) => `  ${v}: ${names.join(", ")}`);
  fail(`Packages not fixed-version:\n${detail.join("\n")}`);
}

// Every published package must state the minimum supported Node.
const MIN_NODE = ">=24";
const missingEngines = [];
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  try {
    const pkg = readJson(join(packagesDir, entry.name, "package.json"));
    if (!pkg.private && pkg.engines?.node !== MIN_NODE) {
      missingEngines.push(
        `${pkg.name ?? entry.name}: engines.node=${pkg.engines?.node ?? "(none)"}`,
      );
    }
  } catch {
    // Ignore missing or invalid package.json
  }
}
if (missingEngines.length > 0) {
  fail(`packages must declare engines.node ${MIN_NODE}:\n${missingEngines.join("\n")}`);
}
console.log(`all packages declare engines.node ${MIN_NODE}`);

const distTag = String(corePkg.version).includes("-") ? "next" : "latest";
emit("version", corePkg.version);
emit("dist_tag", distTag);
console.log(`validated ${corePkg.version} (${distTag})`);
