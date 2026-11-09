#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Decide which release channel a run of `release.yml` is for (ADR 0043). Reads the working tree and
 * the repository's tags, changes nothing, and emits `channel`, `version`, `tag` and `sha`
 * (stdout + GITHUB_OUTPUT when present), plus `sha`, the commit the stable jobs publish and tag.
 *
 * - `stable`: a push to `main` (or the daily run) whose shared version is not a prerelease and has
 *   no `v<version>` tag yet (a release pull request was just merged), or a `workflow_dispatch`
 *   re-run of that version.
 * - `next`: the daily `schedule` run while changesets are pending and a package changed since the
 *   last `next` build (debounced: a quiet day publishes nothing), or a `workflow_dispatch` with
 *   channel `next` while changesets are pending (immediately, changed or not). A plain push to
 *   `main` never publishes `next`.
 * - `none`: nothing to publish.
 *
 * Usage: node scripts/release-detect.mjs <event> [<dispatch-version>] [<dispatch-channel>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listPending } from "./changeset-lib.mjs";

const root = join(import.meta.dirname, "..");

/** What a `next` build is made from: a change outside these paths publishes nothing new. */
const NEXT_INPUTS = ["packages", ".changeset", "package.json", "nub.lock"];

/**
 * The channel for one run.
 *
 * @param {{ event: string, version: string, tagExists: boolean, pending: number, requested?: string,
 *   requestedChannel?: string, changedSinceNext?: boolean }} state
 *   `requested` is the version a stable `workflow_dispatch` asked to publish; `requestedChannel` is
 *   the dispatch's channel (`stable` by default, or `next`); `changedSinceNext` says whether a
 *   package changed since the last `next` build (read only for the daily run).
 * @returns {{ channel: "stable" | "next" | "none" } | { error: string }} The channel, or why the run is refused.
 */
export function chooseChannel(state) {
  if (state.event === "workflow_dispatch") {
    return dispatchChannel(state);
  }
  const { event, version, tagExists, pending, changedSinceNext } = state;
  if (!version.includes("-") && !tagExists) {
    return { channel: "stable" };
  }
  const due = event === "schedule" && pending > 0 && changedSinceNext === true;
  return { channel: due ? "next" : "none" };
}

/** A manual run: publish `next` now, or re-run the stable path for the version on `main`. */
function dispatchChannel({ version, pending, requested, requestedChannel }) {
  if (requestedChannel === "next") {
    return pending > 0
      ? { channel: "next" }
      : { error: "no changeset is pending, so there is nothing to publish under next" };
  }
  if (requested !== version) {
    return { error: `asked to publish ${requested}, but main is at ${version}` };
  }
  // A re-run publishes a stable version that is already on main; skipping what is on the
  // registries and tolerating an existing tag make it safe to repeat.
  return version.includes("-")
    ? { error: `${version} is a prerelease: only a stable version is published by hand` }
    : { channel: "stable" };
}

/**
 * The commit a `next` version was built from: `<version>-next-<short sha>`.
 *
 * @param {string} nextVersion A published `next` version, or "".
 * @returns {string | undefined} The short sha, or undefined when the version is not a snapshot.
 */
export function nextShaOf(nextVersion) {
  return /-next-(?<sha>[0-9a-f]{7,40})$/u.exec(nextVersion.trim())?.groups?.["sha"];
}

/**
 * Whether anything a `next` build is made from changed since the last one. Anything it cannot
 * establish (no `next` yet, npm unreachable, the commit no longer in history) counts as changed:
 * publishing once too often is better than silently never publishing.
 */
function changedSinceLastNext() {
  try {
    const published = execFileSync("npm", ["view", "@storyshelf/core@next", "version"], {
      cwd: root,
      encoding: "utf8",
    });
    const sha = nextShaOf(published);
    if (sha === undefined) return true;
    execFileSync("git", ["diff", "--quiet", sha, "HEAD", "--", ...NEXT_INPUTS], { cwd: root });
    return false;
  } catch {
    return true;
  }
}

function emit(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

/**
 * The commit that introduced `version` (the merged `chore(release): v<version>` commit, also when
 * the pull request was squashed and carries a suffix such as `(#123)`). A retry after a partial
 * publish must publish and tag that commit, not whatever `main` has become, so no match is an
 * error: guessing another commit could ship a different tree under the same version.
 *
 * @param {string} version The shared version.
 * @param {string} [cwd] The repository.
 * @returns {string} A commit sha.
 * @throws {Error} When no commit reachable from HEAD carries the release subject.
 */
export function findReleaseCommit(version, cwd = root) {
  const escaped = version.replaceAll(/[.+-]/gu, String.raw`\$&`);
  const pattern = `^chore\\(release\\): v${escaped}( |$)`;
  const found = execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--extended-regexp", `--grep=${pattern}`],
    { cwd, encoding: "utf8" },
  ).trim();
  if (found === "") {
    throw new Error(`no "chore(release): v${version}" commit is reachable from HEAD`);
  }
  return found;
}

function tagExistsFor(tag) {
  const out = execFileSync("git", ["tag", "--list", tag], { cwd: root, encoding: "utf8" });
  return out.trim() === tag;
}

/** The facts about this checkout that decide the channel. */
function readState(event, requested, requestedChannel) {
  const { version } = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8"));
  return {
    event,
    requested,
    requestedChannel,
    version,
    tagExists: tagExistsFor(`v${version}`),
    pending: listPending(join(root, ".changeset")).length,
    changedSinceNext: event === "schedule" ? changedSinceLastNext() : undefined,
  };
}

function main() {
  const [event, requested, requestedChannel] = process.argv.slice(2);
  if (!event) {
    console.error(
      "usage: node scripts/release-detect.mjs <event> [<dispatch-version>] [<dispatch-channel>]",
    );
    process.exit(1);
  }
  const state = readState(event, requested, requestedChannel);
  const result = chooseChannel(state);
  if ("error" in result) {
    console.error(`::error::${result.error}`);
    process.exit(1);
  }
  emitAll({
    channel: result.channel,
    version: state.version,
    tag: `v${state.version}`,
    sha: shaFor(result.channel, state.version),
  });
}

/** Only a stable release is pinned to its commit; the other channels build the tip of `main`. */
function shaFor(channel, version) {
  if (channel !== "stable") {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  }
  try {
    return findReleaseCommit(version);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

function emitAll(values) {
  for (const [key, value] of Object.entries(values)) {
    emit(key, value);
  }
}

if (process.argv[1] === import.meta.filename) {
  main();
}
