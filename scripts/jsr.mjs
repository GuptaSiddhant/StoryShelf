#!/usr/bin/env node
// oxlint-disable max-statements max-lines-per-function no-console no-await-in-loop complexity
/**
 * JSR management API toolkit for the `@storyshelf` scope.
 *
 * Read + write operations against https://api.jsr.io (see https://jsr.io/docs/api
 * and the OpenAPI spec at https://api.jsr.io/.well-known/openapi).
 *
 * Auth: bearer token from `JSR_TOKEN` (preferred, needs package-write access
 * for mutating commands) falling back to `JSR_SS_TOKEN`. Both are provided
 * via bashrc/secret-tool. The value is never logged. These tokens only work
 * with the `@storyshelf` scope, so the scope is hardcoded — there is
 * intentionally no `--scope` flag.
 *
 * Usage:
 *   nub ./scripts/jsr.mjs status [--package <name>] [--json]
 *   nub ./scripts/jsr.mjs sync [--package <name>] [--dry-run] [--yes] [--json]
 *   nub ./scripts/jsr.mjs versions <pkg> [ver]
 *   nub ./scripts/jsr.mjs score <pkg>
 *   nub ./scripts/jsr.mjs downloads <pkg>
 *   nub ./scripts/jsr.mjs tasks <pkg>
 *   nub ./scripts/jsr.mjs scope | members | whoami
 *   nub ./scripts/jsr.mjs yank <pkg>@<ver> --yes
 *   nub ./scripts/jsr.mjs unyank <pkg>@<ver> --yes
 *   nub ./scripts/jsr.mjs set-desc <pkg> --text "..." --yes
 *   nub ./scripts/jsr.mjs set-runtime <pkg> --node true --deno true [--browser false] [--workerd false] --yes
 *   nub ./scripts/jsr.mjs set-github <pkg> --owner <o> --repo <r> --yes
 *   nub ./scripts/jsr.mjs set-github <pkg> --clear --yes
 *
 * `sync` is idempotent: for every public local package it creates the JSR
 * package when missing (404) and PATCHes description/githubRepository on
 * drift, plus runtimeCompat only when `package.json` declares an explicit
 * `jsr.runtimeCompat` map (otherwise JSR's own inference is left alone).
 * Each PATCH carries a single field, since JSR's UpdatePackageRequest is a
 * oneOf. Run it after adding a new public `packages/<name>/package.json`
 * and it will be registered automatically.
 *
 * Runtime-compat convention: `node: true` implies `deno: true` + `bun: true`
 * (both runtimes target Node compatibility); `browser`/`workerd` are marked
 * explicitly only when verified.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPublicPackageNames } from "./public-packages.mjs";

const { dirname } = import.meta;
const PACKAGES_DIR = join(dirname, "..", "packages");

const SCOPE = "storyshelf";
const API_BASE = "https://api.jsr.io";
const TOKEN_VARS = ["JSR_TOKEN", "JSR_SS_TOKEN"];
const USER_AGENT = "storyshelf-jsr/1.0; https://github.com/GuptaSiddhant/storyshelf";
const SCOPE_PREFIX = "@storyshelf/";
const MAX_DESCRIPTION = 250;
const RUNTIME_KEYS = ["node", "deno", "browser", "workerd", "bun"];
const GITHUB_RE = /github\.com[/:](?<owner>[^/\s]+)\/(?<name>[^/\s]+?)(?:\.git)?$/u;
const VALUE_FLAGS = new Set([
  "package",
  "text",
  "owner",
  "repo",
  "node",
  "deno",
  "browser",
  "workerd",
]);

class JsrError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "JsrError";
    this.status = status;
  }
}

function log(message) {
  console.log(`[jsr] ${message}`);
}

function logError(message) {
  console.error(`[jsr:error] ${message}`);
}

function printHelp() {
  console.log(`Usage: nub ./scripts/jsr.mjs <command> [options]

Commands (read):
  status [--package <n>] [--json]   Local vs JSR audit (missing/unpublished/published)
  versions <pkg> [ver] [--json]     List versions, or show one version
  score <pkg>                       JSR quality score
  downloads <pkg>                   90-day download stats
  tasks <pkg>                       Publishing tasks (debug failed deno publish)
  scope                             Scope details (quotas/settings when member)
  members                           Scope members
  whoami                            Authenticated user + scopes

Commands (write, require --yes unless --dry-run):
  sync [--package <n>] [--dry-run] [--yes] [--json]
    Create missing JSR packages + PATCH description/runtimeCompat/githubRepository drift.
  yank|unyank <pkg>@<ver> --yes     Yank or unyank a version
  set-desc <pkg> --text "..." --yes Set package description (max 250 chars)
  set-runtime <pkg> --node/--deno/--browser/--workerd/--bun true|false --yes
  set-github <pkg> --owner <o> --repo <r> --yes | set-github <pkg> --clear --yes

Auth: ${TOKEN_VARS.join("/")} env var (bashrc via secret-tool). Scope is fixed to @${SCOPE}.`);
}

function pushToken(parsed, arg) {
  if (parsed.command === null) {
    parsed.command = arg;
    return;
  }
  parsed.positional.push(arg);
}

function consumeArg(parsed, argv, index) {
  const arg = argv[index];
  if (!arg.startsWith("--")) {
    pushToken(parsed, arg);
    return index + 1;
  }
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    parsed.flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    return index + 1;
  }
  const key = arg.slice(2);
  if (!VALUE_FLAGS.has(key)) {
    parsed.flags[key] = true;
    return index + 1;
  }
  parsed.flags[key] = argv[index + 1];
  return index + 2;
}

function parseArgs(argv) {
  const parsed = { command: null, positional: [], flags: {} };
  let index = 0;
  while (index < argv.length) index = consumeArg(parsed, argv, index);
  return parsed;
}

function flagTrue(flags, name) {
  return flags[name] === true || flags[name] === "true";
}

function getToken() {
  const found = TOKEN_VARS.find((name) => process.env[name]);
  if (!found) {
    throw new Error(
      `${TOKEN_VARS.join(" or ")} is not set (expected from bashrc via secret-tool). Create one at JSR account Settings -> Tokens.`,
    );
  }
  return process.env[found];
}

function buildHeaders(token, hasBody) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (hasBody) headers["Content-Type"] = "application/json";
  return headers;
}

function errorMessage(response, data) {
  const detail = data?.code ? ` (${data.code})` : "";
  const text = data?.message ?? data?.error ?? response.statusText;
  return `JSR API ${response.status}${detail}: ${text}`;
}

async function readResponse(response) {
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (response.ok) return data;
  throw new JsrError(response.status, errorMessage(response, data));
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: buildHeaders(token, Boolean(options.json)),
    body: options.json ? JSON.stringify(options.json) : undefined,
  });
  return readResponse(response);
}

async function fetchPackage(jsr) {
  try {
    return await apiFetch(`/scopes/${SCOPE}/packages/${jsr}`);
  } catch (error) {
    if (error instanceof JsrError && error.status === 404) return null;
    throw error;
  }
}

function unwrapItems(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function fetchVersions(jsr) {
  try {
    return unwrapItems(await apiFetch(`/scopes/${SCOPE}/packages/${jsr}/versions`));
  } catch (error) {
    if (error instanceof JsrError && error.status === 404) return [];
    throw error;
  }
}

function normalizePkgRef(ref) {
  if (ref.startsWith(SCOPE_PREFIX)) return ref.slice(SCOPE_PREFIX.length);
  return ref;
}

function parseGithub(repo) {
  const url = typeof repo === "string" ? repo : repo?.url;
  if (typeof url !== "string") return null;
  const match = GITHUB_RE.exec(url);
  if (!match?.groups) return null;
  return { owner: match.groups["owner"], name: match.groups["name"].replace(/\/$/u, "") };
}

function localDescription(pkg, dir) {
  const desc = typeof pkg.description === "string" ? pkg.description : "";
  if (desc.length > MAX_DESCRIPTION) {
    throw new Error(
      `${dir}: description is ${desc.length} chars, JSR allows max ${MAX_DESCRIPTION} — shorten package.json first.`,
    );
  }
  return desc;
}

function explicitRuntime(pkg) {
  const override = pkg.jsr?.runtimeCompat;
  if (typeof override !== "object" || override === null || Array.isArray(override)) return null;
  return override;
}

function toLocalDetail(name) {
  if (!name.startsWith(SCOPE_PREFIX)) {
    throw new Error(
      `${name} is outside @${SCOPE}/ — this token only works with the @${SCOPE} scope.`,
    );
  }
  const dir = name.slice(SCOPE_PREFIX.length);
  const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8"));
  return {
    dir,
    name,
    jsr: normalizePkgRef(name),
    description: localDescription(pkg, dir),
    version: String(pkg.version ?? "0.0.0"),
    runtimeCompat: explicitRuntime(pkg),
    github: parseGithub(pkg.repository),
  };
}

function listLocalDetails() {
  return getPublicPackageNames()
    .map((name) => toLocalDetail(name))
    .toSorted((a, b) => a.jsr.localeCompare(b.jsr));
}

function selectPackages(flags) {
  const all = listLocalDetails();
  if (!flags.package) return all;
  const jsr = normalizePkgRef(String(flags.package));
  const found = all.find((local) => local.jsr === jsr);
  if (!found)
    throw new Error(
      `no local public package '${flags.package}' (dir packages/${jsr} missing or private).`,
    );
  return [found];
}

function runtimeDrift(explicit, live) {
  const base = live ?? {};
  return Object.keys(explicit).some((key) => base[key] !== explicit[key]);
}

function githubEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  );
}

function diffMetadata(local, remote) {
  const patches = [];
  if (local.description && local.description !== remote?.description) {
    patches.push({ field: "description", body: { description: local.description } });
  }
  const liveRuntime = remote?.runtimeCompat ?? null;
  if (local.runtimeCompat && runtimeDrift(local.runtimeCompat, liveRuntime)) {
    patches.push({
      field: "runtimeCompat",
      body: { runtimeCompat: { ...liveRuntime, ...local.runtimeCompat } },
    });
  }
  if (local.github && !githubEqual(local.github, remote?.githubRepository ?? null)) {
    patches.push({ field: "githubRepository", body: { githubRepository: local.github } });
  }
  return patches;
}

function requireYes(flags, action) {
  if (!flagTrue(flags, "yes")) {
    throw new Error(`refusing to ${action} without --yes (or preview with --dry-run).`);
  }
}

async function createPackage(local, dry) {
  log(`${dry ? "would create" : "creating"} @${SCOPE}/${local.jsr}`);
  if (!dry) {
    await apiFetch(`/scopes/${SCOPE}/packages`, { method: "POST", json: { package: local.jsr } });
  }
}

async function applyPatches(jsr, patches, dry) {
  for (const patch of patches) {
    log(`${dry ? "would update" : "updating"} @${SCOPE}/${jsr}: ${patch.field}`);
    if (!dry) {
      await apiFetch(`/scopes/${SCOPE}/packages/${jsr}`, { method: "PATCH", json: patch.body });
    }
  }
}

function noteSynced(summary, local, existed) {
  if (existed) summary.inSync.push(local.jsr);
  else summary.created.push(local.jsr);
}

async function syncOne(local, summary, dry) {
  const remote = await fetchPackage(local.jsr);
  if (!remote) await createPackage(local, dry);
  const patches = diffMetadata(local, remote);
  if (patches.length === 0) {
    noteSynced(summary, local, Boolean(remote));
    return;
  }
  await applyPatches(local.jsr, patches, dry);
  summary.updated.push({ package: local.jsr, fields: patches.map((patch) => patch.field) });
}

function printSummary(summary, flags) {
  if (flagTrue(flags, "json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  log(
    `sync ${summary.dryRun ? "(dry-run) " : ""}done: ${summary.created.length} created, ${summary.updated.length} updated, ${summary.inSync.length} in sync`,
  );
  for (const name of summary.created) log(`  created @${SCOPE}/${name}`);
  for (const entry of summary.updated)
    log(`  updated @${SCOPE}/${entry.package}: ${entry.fields.join(", ")}`);
}

async function cmdSync(flags) {
  const dry = flagTrue(flags, "dry-run");
  if (!dry) requireYes(flags, "sync package metadata");
  const selected = selectPackages(flags);
  const summary = { scope: SCOPE, dryRun: dry, created: [], updated: [], inSync: [] };
  for (const local of selected) await syncOne(local, summary, dry);
  printSummary(summary, flags);
}

async function statusRow(local) {
  const remote = await fetchPackage(local.jsr);
  const id = `@${SCOPE}/${local.jsr}`;
  if (!remote)
    return { package: id, local: local.version, published: [], state: "missing: run sync" };
  const versions = await fetchVersions(local.jsr);
  const match = versions.find((entry) => entry.version === local.version);
  const state = match ? (match.yanked ? "published (yanked)" : "published") : "unpublished";
  return {
    package: id,
    local: local.version,
    published: versions.map((entry) => entry.version),
    state,
  };
}

async function cmdStatus(flags) {
  const selected = selectPackages(flags);
  const rows = [];
  for (const local of selected) rows.push(await statusRow(local));
  if (flagTrue(flags, "json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const row of rows) log(`${row.package} local=${row.local} state=${row.state}`);
}

function requirePkg(positional) {
  const ref = positional[0];
  if (!ref) throw new Error("missing <pkg> argument.");
  return normalizePkgRef(ref);
}

async function cmdVersions(positional, flags) {
  const jsr = requirePkg(positional);
  if (positional[1]) {
    const detail = await apiFetch(`/scopes/${SCOPE}/packages/${jsr}/versions/${positional[1]}`);
    console.log(JSON.stringify(detail, null, 2));
    return;
  }
  const versions = await fetchVersions(jsr);
  if (flagTrue(flags, "json")) {
    console.log(JSON.stringify(versions, null, 2));
    return;
  }
  if (versions.length === 0) log("(no versions)");
  for (const entry of versions) log(`${entry.version}${entry.yanked ? " (yanked)" : ""}`);
}

async function cmdShow(path) {
  console.log(JSON.stringify(await apiFetch(path), null, 2));
}

function splitPkgVersion(ref) {
  const at = ref.lastIndexOf("@");
  if (at < 1) throw new Error(`expected <pkg>@<ver>, got '${ref}'.`);
  return { jsr: normalizePkgRef(ref.slice(0, at)), version: ref.slice(at + 1) };
}

async function cmdYank(positional, flags, yanked) {
  const ref = positional[0];
  if (!ref) throw new Error("missing <pkg>@<ver> argument.");
  requireYes(flags, yanked ? "yank" : "unyank");
  const { jsr, version } = splitPkgVersion(ref);
  await apiFetch(`/scopes/${SCOPE}/packages/${jsr}/versions/${version}`, {
    method: "PATCH",
    json: { yanked },
  });
  log(`${yanked ? "yanked" : "unyanked"} @${SCOPE}/${jsr}@${version}`);
}

async function cmdSetDesc(positional, flags) {
  const jsr = requirePkg(positional);
  const text = flags.text ?? positional[1];
  if (!text) throw new Error('missing --text "..." (or second positional arg).');
  requireYes(flags, "update description");
  await apiFetch(`/scopes/${SCOPE}/packages/${jsr}`, {
    method: "PATCH",
    json: { description: String(text) },
  });
  log(`updated @${SCOPE}/${jsr}: description`);
}

function parseBoolFlag(value, name) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`--${name} expects true/false, got '${value}'.`);
}

function collectRuntimeFlags(flags) {
  const next = {};
  for (const key of RUNTIME_KEYS) {
    if (flags[key] !== undefined) next[key] = parseBoolFlag(flags[key], key);
  }
  return next;
}

async function cmdSetRuntime(positional, flags) {
  const jsr = requirePkg(positional);
  const partial = collectRuntimeFlags(flags);
  if (Object.keys(partial).length === 0) {
    throw new Error("pass at least one of --node/--deno/--browser/--workerd/--bun true|false.");
  }
  requireYes(flags, "update runtimeCompat");
  const remote = await fetchPackage(jsr);
  const next = { ...remote?.runtimeCompat, ...partial };
  await apiFetch(`/scopes/${SCOPE}/packages/${jsr}`, {
    method: "PATCH",
    json: { runtimeCompat: next },
  });
  log(`updated @${SCOPE}/${jsr}: runtimeCompat`);
}

async function cmdSetGithub(positional, flags) {
  const jsr = requirePkg(positional);
  requireYes(flags, "update githubRepository");
  if (flagTrue(flags, "clear")) {
    await apiFetch(`/scopes/${SCOPE}/packages/${jsr}`, {
      method: "PATCH",
      json: { githubRepository: null },
    });
    log(`cleared @${SCOPE}/${jsr}: githubRepository`);
    return;
  }
  if (!flags.owner || !flags.repo) throw new Error("missing --owner <o> --repo <r> (or --clear).");
  const body = { githubRepository: { owner: String(flags.owner), name: String(flags.repo) } };
  await apiFetch(`/scopes/${SCOPE}/packages/${jsr}`, { method: "PATCH", json: body });
  log(`updated @${SCOPE}/${jsr}: githubRepository`);
}

function runCommand(parsed) {
  const { command, positional, flags } = parsed;
  if (command === "status") return cmdStatus(flags);
  if (command === "sync") return cmdSync(flags);
  if (command === "versions") return cmdVersions(positional, flags);
  if (command === "score")
    return cmdShow(`/scopes/${SCOPE}/packages/${requirePkg(positional)}/score`);
  if (command === "downloads")
    return cmdShow(`/scopes/${SCOPE}/packages/${requirePkg(positional)}/downloads`);
  if (command === "tasks")
    return cmdShow(`/scopes/${SCOPE}/packages/${requirePkg(positional)}/publishing_tasks`);
  if (command === "scope") return cmdShow(`/scopes/${SCOPE}`);
  if (command === "members") return cmdShow(`/scopes/${SCOPE}/members`);
  if (command === "whoami") return cmdShow("/user");
  if (command === "yank") return cmdYank(positional, flags, true);
  if (command === "unyank") return cmdYank(positional, flags, false);
  if (command === "set-desc") return cmdSetDesc(positional, flags);
  if (command === "set-runtime") return cmdSetRuntime(positional, flags);
  if (command === "set-github") return cmdSetGithub(positional, flags);
  throw new Error(`unknown command '${command}'. Run with --help.`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (
    !parsed.command ||
    parsed.command === "help" ||
    flagTrue(parsed.flags, "help") ||
    flagTrue(parsed.flags, "h")
  ) {
    printHelp();
    return;
  }
  await runCommand(parsed);
}

try {
  await main();
} catch (error) {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
