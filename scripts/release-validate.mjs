#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Release validation gate — single source of truth for the release workflow.
 * Checks: tag matches the fixed workspace version, all non-private packages
 * share one version, every public package has a matching deno.json version.
 * Emits `version` and `dist_tag` (stdout + GITHUB_OUTPUT when present).
 *
 * Usage:
 *   node scripts/release-validate.mjs v0.3.1
 *   node scripts/release-validate.mjs "$GITHUB_REF_NAME"
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

const tag = process.argv[2];
if (!tag) {
  fail("missing tag argument: node scripts/release-validate.mjs <tag>");
}

const corePkg = readJson(join(packagesDir, "core", "package.json"));
console.log(`tag=${tag} pkg=v${corePkg.version}`);
if (tag !== `v${corePkg.version}`) {
  fail(`Tag ${tag} != packages/core version v${corePkg.version}`);
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

// deno.json versions must match package.json.
const bad = [];
const missing = [];
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  let pkg;
  try {
    pkg = readJson(join(packagesDir, entry.name, "package.json"));
  } catch {
    continue;
  }
  if (pkg.private) {
    continue;
  }
  let jsr = null;
  try {
    jsr = readJson(join(packagesDir, entry.name, "deno.json"));
  } catch {
    // Missing or invalid deno.json
  }
  if (!jsr) {
    missing.push(entry.name);
    continue;
  }
  if (jsr.version !== pkg.version) {
    bad.push(`${entry.name}: deno=${jsr.version} pkg=${pkg.version}`);
  }
}
if (missing.length > 0) {
  fail(`missing deno.json:\n${missing.join("\n")}`);
}
if (bad.length > 0) {
  fail(`deno.json/package.json version mismatch:\n${bad.join("\n")}`);
}
console.log("all deno.json versions match package.json");

const distTag = String(corePkg.version).includes("-") ? "next" : "latest";
emit("version", corePkg.version);
emit("dist_tag", distTag);
console.log(`validated ${corePkg.version} (${distTag})`);
