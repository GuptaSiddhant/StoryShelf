#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Decide which release channel a run of `release.yml` is for (ADR 0043). Reads the working tree and
 * the repository's tags, changes nothing, and emits `channel`, `version`, `tag` and `sha`
 * (stdout + GITHUB_OUTPUT when present), plus `sha`, the commit the stable jobs publish and tag.
 *
 * - `stable`: a push to `main` whose shared version is not a prerelease and has no `v<version>` tag
 *   yet (a release pull request was just merged), or a `workflow_dispatch` re-run of that version.
 * - `next`: any other push to `main` while changesets are pending.
 * - `none`: nothing to publish.
 *
 * Usage: node scripts/release-detect.mjs <event> [<dispatch-version>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listPending } from "./changeset-lib.mjs";

const root = join(import.meta.dirname, "..");

/**
 * The channel for one run.
 *
 * @param {{ event: string, version: string, tagExists: boolean, pending: number, requested?: string }} state
 *   `requested` is the version a `workflow_dispatch` asked to publish.
 * @returns {{ channel: "stable" | "next" | "none" } | { error: string }} The channel, or why the run is refused.
 */
export function chooseChannel({ event, version, tagExists, pending, requested }) {
  const prerelease = version.includes("-");
  if (event === "workflow_dispatch") {
    if (requested !== version) {
      return { error: `asked to publish ${requested}, but main is at ${version}` };
    }
    // A re-run publishes a stable version that is already on main; skipping what is on the
    // registries and tolerating an existing tag make it safe to repeat.
    return prerelease
      ? { error: `${version} is a prerelease: only a stable version is published by hand` }
      : { channel: "stable" };
  }
  if (!prerelease && !tagExists) {
    return { channel: "stable" };
  }
  return { channel: pending > 0 ? "next" : "none" };
}

function emit(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

/**
 * The commit that introduced `version` (the merged `chore(release): v<version>` commit, also when
 * the pull request was squashed and carries a suffix such as `(#123)`), or HEAD when none matches.
 * A retry after a partial publish must publish and tag that commit, not whatever `main` has become.
 *
 * @param {string} version The shared version.
 * @param {string} [cwd] The repository.
 * @returns {string} A commit sha.
 */
export function findReleaseCommit(version, cwd = root) {
  const escaped = version.replaceAll(/[.+-]/gu, String.raw`\$&`);
  const pattern = `^chore\\(release\\): v${escaped}( |$)`;
  const found = execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--extended-regexp", `--grep=${pattern}`],
    { cwd, encoding: "utf8" },
  ).trim();
  return found || execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

function tagExistsFor(tag) {
  const out = execFileSync("git", ["tag", "--list", tag], { cwd: root, encoding: "utf8" });
  return out.trim() === tag;
}

/** The facts about this checkout that decide the channel. */
function readState(event, requested) {
  const { version } = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8"));
  return {
    event,
    requested,
    version,
    tagExists: tagExistsFor(`v${version}`),
    pending: listPending(join(root, ".changeset")).length,
  };
}

function main() {
  const [event, requested] = process.argv.slice(2);
  if (!event) {
    console.error("usage: node scripts/release-detect.mjs <event> [<dispatch-version>]");
    process.exit(1);
  }
  const state = readState(event, requested);
  const result = chooseChannel(state);
  if ("error" in result) {
    console.error(`::error::${result.error}`);
    process.exit(1);
  }
  emitAll({
    channel: result.channel,
    version: state.version,
    tag: `v${state.version}`,
    sha: findReleaseCommit(state.version),
  });
}

function emitAll(values) {
  for (const [key, value] of Object.entries(values)) {
    emit(key, value);
  }
}

if (process.argv[1] === import.meta.filename) {
  main();
}
