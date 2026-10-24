#!/usr/bin/env node
// oxlint-disable max-statements max-lines-per-function no-console no-await-in-loop complexity
/**
 * Deprecate every published version of the retired packages in
 * `docs/deprecated.json`.
 *
 * npm: `nub deprecate <name> <message>` applies to every published version.
 * JSR: has no deprecation API, so the package is archived through
 * `scripts/jsr.mjs` instead.
 *
 * A registry is only marked done after its state is re-read and confirmed.
 * Progress is written after each package, so a partial run is resumable.
 *
 * Usage:
 *   nub ./scripts/deprecate-packages.mjs --dry-run
 *   nub ./scripts/deprecate-packages.mjs
 *   nub ./scripts/deprecate-packages.mjs --npm-only
 *   nub ./scripts/deprecate-packages.mjs --jsr-only
 *   nub ./scripts/deprecate-packages.mjs --otp 123456
 *   nub ./scripts/deprecate-packages.mjs --package @storyshelf/db-turso
 */
import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DEFAULT_FILE = join(ROOT, "docs", "deprecated.json");
const JSR_SCRIPT = join(ROOT, "scripts", "jsr.mjs");
const NPM_REGISTRY = "https://registry.npmjs.org";
const JSR_API = "https://api.jsr.io";
const JSR_SCOPE = "storyshelf";
const SCOPE_PREFIX = "@storyshelf/";
const REQUEST_TIMEOUT_MS = 30_000;
const CONFIRM_ATTEMPTS = 5;
const CONFIRM_DELAY_MS = 1000;
const NPM_STATES = new Set(["pending", "deprecated"]);
const JSR_STATES = new Set(["pending", "archived", "not-published"]);

function log(message) {
  console.log(`[deprecate] ${message}`);
}

function printHelp() {
  console.log(`Usage: nub ./scripts/deprecate-packages.mjs [options]

Deprecates every published npm version and archives the JSR package for each
entry in docs/deprecated.json. Confirmed states are written back to the JSON.

Options:
  --dry-run             Show what would change; never mutate a registry or file
  --npm-only            Skip JSR
  --jsr-only            Skip npm
  --otp <code>          npm one-time password for 2FA
  --package <name>      Process one package (e.g. @storyshelf/db-turso)
  --file <path>         Read/write a different JSON file
  -h, --help            Show this help

Auth:
  npm: run \`nub login\` or configure a granular npm token
  JSR: set JSR_TOKEN (or JSR_SS_TOKEN) with package-write access

JSR has no deprecation API; this script archives the package, which blocks new
versions and hides it from search while keeping existing versions installable.`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    npm: true,
    jsr: true,
    file: DEFAULT_FILE,
    package: null,
    otp: null,
    help: false,
  };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--npm-only") {
      options.jsr = false;
    } else if (arg === "--jsr-only") {
      options.npm = false;
    } else if (arg === "--file" || arg === "--package" || arg === "--otp") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} expects a value.`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument '${arg}'. Run with --help.`);
    }
    index += 1;
  }
  return options;
}

function readState(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
  validateState(data);
  return data;
}

function validateState(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.packages)) {
    throw new Error("deprecated JSON must contain a packages array.");
  }
  const names = new Set();
  for (const [index, entry] of data.packages.entries()) {
    validateEntry(entry, index, names);
  }
}

function validateEntry(entry, index, names) {
  const label = `packages[${index}]`;
  if (!entry || typeof entry !== "object") throw new Error(`${label} must be an object.`);
  if (typeof entry.name !== "string" || !entry.name.startsWith(SCOPE_PREFIX)) {
    throw new Error(`${label}.name must start with ${SCOPE_PREFIX}.`);
  }
  if (names.has(entry.name)) throw new Error(`${label}.name duplicates ${entry.name}.`);
  names.add(entry.name);
  if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
    throw new Error(`${label}.reason must be a non-empty string.`);
  }
  validateNewPackage(entry, label);
  validateStatus(entry.npm, "npm", NPM_STATES, label);
  validateStatus(entry.jsr, "jsr", JSR_STATES, label);
}

function validateNewPackage(entry, label) {
  if (entry.newPackage === undefined) return;
  if (typeof entry.newPackage !== "string" || !entry.newPackage.startsWith(SCOPE_PREFIX)) {
    throw new Error(`${label}.newPackage must start with ${SCOPE_PREFIX}.`);
  }
}

function validateStatus(status, key, validStates, label) {
  if (!status || typeof status !== "object" || !validStates.has(status.state)) {
    throw new Error(`${label}.${key}.state must be one of: ${[...validStates].join(", ")}.`);
  }
}

function saveState(path, data) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporary, path);
}

function selectPackages(data, name) {
  if (!name) return data.packages;
  const selected = data.packages.filter((entry) => entry.name === name);
  if (selected.length === 0) throw new Error(`${name} is not listed in the deprecated JSON.`);
  return selected;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function fetchJson(url, label, allowNotFound = false) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.json();
}

function fetchNpmPackument(name) {
  return fetchJson(`${NPM_REGISTRY}/${name.replace("/", "%2F")}`, `npm lookup for ${name}`);
}

function npmVersions(packument) {
  return Object.keys(packument.versions ?? {});
}

function isNpmDeprecated(packument, version) {
  return Boolean(packument.versions?.[version]?.deprecated);
}

function npmMessage(entry) {
  const replacement = entry.newPackage ? ` Use ${entry.newPackage} instead.` : "";
  return `Deprecated: ${entry.reason.trim()}${replacement} See docs/deprecated.json.`;
}

function runLocal(command, args, label) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status ?? "unknown"}.`);
  }
}

function requireNpmAuth() {
  const result = spawnSync("nub", ["whoami"], { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw new Error(`nub is required for npm deprecation: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error("npm authentication is required: run `nub login` or configure a token.");
  }
}

function requireJsrAuth() {
  if (process.env.JSR_TOKEN || process.env.JSR_SS_TOKEN) return;
  throw new Error(
    "JSR authentication is required: set JSR_TOKEN or JSR_SS_TOKEN, or pass --npm-only.",
  );
}

function remainingNpmVersions(versions, packument) {
  return versions.filter((version) => !isNpmDeprecated(packument, version));
}

async function confirmNpm(name, versions) {
  let packument = null;
  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt += 1) {
    packument = await fetchNpmPackument(name);
    if (remainingNpmVersions(versions, packument).length === 0) return packument;
    if (attempt < CONFIRM_ATTEMPTS) await sleep(CONFIRM_DELAY_MS);
  }
  const remaining = remainingNpmVersions(versions, packument);
  throw new Error(`npm confirmation failed for ${name}: still pending ${remaining.join(", ")}.`);
}

async function deprecateNpm(entry, options, save) {
  if (entry.npm.state === "deprecated") {
    log(`npm ${entry.name}: already recorded as deprecated`);
    return;
  }
  const before = await fetchNpmPackument(entry.name);
  const versions = npmVersions(before);
  if (versions.length === 0) throw new Error(`npm ${entry.name}: no published versions found.`);
  const pending = versions.filter((version) => !isNpmDeprecated(before, version));
  if (options.dryRun) {
    log(
      `npm ${entry.name}: would deprecate ${pending.length}/${versions.length} pending version(s)`,
    );
    return;
  }
  const message = npmMessage(entry);
  if (pending.length > 0) {
    log(`npm ${entry.name}: deprecating ${pending.length}/${versions.length} version(s)`);
    const args = ["deprecate"];
    if (options.otp) args.push("--otp", options.otp);
    args.push(entry.name, message);
    runLocal("nub", args, `nub deprecate ${entry.name}`);
    await confirmNpm(entry.name, versions);
  }
  entry.npm = {
    state: "deprecated",
    confirmedAt: new Date().toISOString(),
    versions,
    message,
  };
  save();
  log(`npm ${entry.name}: confirmed deprecated`);
}

function jsrPackageName(name) {
  return name.slice(SCOPE_PREFIX.length);
}

function fetchJsrPackage(name) {
  return fetchJson(
    `${JSR_API}/scopes/${JSR_SCOPE}/packages/${jsrPackageName(name)}`,
    `JSR lookup for ${name}`,
    true,
  );
}

async function confirmJsrArchived(name) {
  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt += 1) {
    const remote = await fetchJsrPackage(name);
    if (remote?.isArchived === true) return remote;
    if (attempt < CONFIRM_ATTEMPTS) await sleep(CONFIRM_DELAY_MS);
  }
  throw new Error(`JSR confirmation failed for ${name}: package is not archived.`);
}

async function deprecateJsr(entry, options, save) {
  if (entry.jsr.state === "archived" || entry.jsr.state === "not-published") {
    log(`jsr ${entry.name}: already recorded as ${entry.jsr.state}`);
    return;
  }
  const remote = await fetchJsrPackage(entry.name);
  if (!remote) {
    if (!options.dryRun) {
      entry.jsr = { state: "not-published", confirmedAt: new Date().toISOString() };
      save();
    }
    log(`jsr ${entry.name}: not published`);
    return;
  }
  if (remote.isArchived) {
    if (!options.dryRun) {
      entry.jsr = { state: "archived", confirmedAt: new Date().toISOString() };
      save();
    }
    log(`jsr ${entry.name}: already archived`);
    return;
  }
  if (options.dryRun) {
    log(`jsr ${entry.name}: would archive (JSR has no deprecation API)`);
    return;
  }
  log(`jsr ${entry.name}: archiving (JSR has no deprecation API)`);
  runLocal(
    process.execPath,
    [JSR_SCRIPT, "deprecate", entry.name, "--yes"],
    `JSR deprecate ${entry.name}`,
  );
  await confirmJsrArchived(entry.name);
  entry.jsr = { state: "archived", confirmedAt: new Date().toISOString() };
  save();
  log(`jsr ${entry.name}: confirmed archived`);
}

function preflight(selected, options) {
  if (options.dryRun) return;
  const needsNpm = options.npm && selected.some((entry) => entry.npm.state !== "deprecated");
  const needsJsr =
    options.jsr &&
    selected.some((entry) => entry.jsr.state !== "archived" && entry.jsr.state !== "not-published");
  if (!needsNpm && !needsJsr) return;
  if (needsNpm) requireNpmAuth();
  if (needsJsr) requireJsrAuth();
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.npm && !options.jsr) throw new Error("both registries are disabled.");
  const path = resolve(options.file);
  const data = readState(path);
  const selected = selectPackages(data, options.package);
  const save = () => {
    saveState(path, data);
  };
  preflight(selected, options);
  log(
    `${options.dryRun ? "dry run: " : ""}${selected.length} package(s) from ${relative(ROOT, path)}`,
  );
  for (const entry of selected) {
    if (options.npm) await deprecateNpm(entry, options, save);
    if (options.jsr) await deprecateJsr(entry, options, save);
  }
  log(options.dryRun ? "dry run complete; no files changed" : "deprecation pass complete");
}

try {
  await run();
} catch (error) {
  console.error(`[deprecate:error] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
