#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * CI gate (ADR 0043, decision 7): a pull request that changes the source of a package or a
 * published manifest must add a changeset, unless it carries the `no-release` label.
 *
 * A release pull request (head branch `release/v<version>`, `--head-ref`) adds no changeset: it
 * consumes them. It passes when it changes only package versions, `CHANGELOG.md` and deleted
 * changesets, and fails when it changes anything else.
 *
 * Reads the pull request as the checkout's merge commit (first parent = the base branch tip), the
 * same way the `changes` job does.
 *
 * Usage:
 *   node scripts/changeset-check.mjs [--labels a,b] [--head-ref <branch>] [--base <ref>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  checkChangeset,
  malformedChangesets,
  manifestPublished,
  releaseBranchVersion,
  releaseProblems,
} from "./changeset-lib.mjs";

const root = join(import.meta.dirname, "..");

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** Parse `git diff --name-status` output into changed paths, added/modified paths, and status entries. */
function parseNameStatus(out) {
  const rows = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status: status.charAt(0), paths };
    });
  return {
    changed: rows.flatMap(({ paths }) => paths),
    added: rows.filter(({ status }) => status !== "D").map(({ paths }) => paths.at(-1)),
    entries: rows.map(({ status, paths }) => ({ status, path: paths.at(-1) })),
  };
}

/** `git diff --name-status` between the base and HEAD. */
function diff(base) {
  const out = execFileSync("git", ["diff", "--name-status", base, "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  return parseNameStatus(out);
}

function readHead(path) {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return null; // deleted in the PR
  }
}

function readBase(base, path) {
  try {
    return execFileSync("git", ["show", `${base}:${path}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // new in the PR
  }
}

/** The published packages: `packages/<dir>/package.json` paths and names (a package is published unless private). */
function publishedPackages() {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`)
    .map((path) => ({ path, pkg: readHead(path) }))
    .filter(({ pkg }) => pkg !== null && manifestPublished(pkg))
    .map(({ path, pkg }) => ({ path, name: JSON.parse(pkg).name }));
}

const labels = (option("--labels") ?? "").split(",").filter(Boolean);
const base = option("--base") ?? "HEAD^1";
const headRef = option("--head-ref");
const { changed, added, entries } = diff(base);
const published = publishedPackages();
const malformed = malformedChangesets(
  added,
  (path) => readFileSync(join(root, path), "utf8"),
  published.map(({ name }) => name),
);
if (malformed.length > 0) {
  console.error(`::error title=Malformed changeset::${malformed.join("; ")}`);
  process.exit(1);
}
const releaseVersion = releaseBranchVersion(headRef);
if (releaseVersion !== null) {
  const problems = releaseProblems({
    version: releaseVersion,
    entries,
    readBase: (path) => readBase(base, path),
    readHead,
    published: published.map(({ path }) => path),
  });
  if (problems.length > 0) {
    console.error(
      `::error title=Not a release::Branch ${headRef} may change only package versions, CHANGELOG.md and deleted changesets: ${problems.join("; ")}`,
    );
    process.exit(1);
  }
  console.log(
    `changeset check passed: release ${releaseVersion} (versions, changelog, consumed changesets)`,
  );
  process.exit(0);
}
const isPublished = (manifest) => manifestPublished(readHead(manifest), readBase(base, manifest));
const verdict = checkChangeset({ changed, added, labels, isPublished });
if (verdict.ok) {
  console.log(`changeset check passed: ${verdict.reason}`);
} else {
  console.error(
    `::error title=Changeset missing::This pull request ${verdict.reason}. Run \`nub run changeset <patch|minor|major>\`, then edit and commit the file, or add the \`no-release\` label if nothing shipped changes (docs, tests, CI).`,
  );
  process.exit(1);
}
