#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * CI gate (ADR 0043, decision 7): a pull request that changes the source of a package or a
 * published manifest must add a changeset, unless it carries the `no-release` label.
 *
 * Reads the pull request as the checkout's merge commit (first parent = the base branch tip), the
 * same way the `changes` job does.
 *
 * Usage:
 *   node scripts/changeset-check.mjs [--labels a,b] [--base <ref>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkChangeset, malformedChangesets, manifestPublished } from "./changeset-lib.mjs";

const root = join(import.meta.dirname, "..");

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** `git diff --name-status` between the base and HEAD, as changed paths and added/modified paths. */
function diff(base) {
  const out = execFileSync("git", ["diff", "--name-status", base, "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const changed = [];
  const added = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);
    changed.push(...paths);
    if (status !== "D") {
      added.push(path);
    }
  }
  return { changed, added };
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

const labels = (option("--labels") ?? "").split(",").filter(Boolean);
const base = option("--base") ?? "HEAD^1";
const { changed, added } = diff(base);
const malformed = malformedChangesets(added, (path) => readFileSync(join(root, path), "utf8"));
if (malformed.length > 0) {
  console.error(`::error title=Malformed changeset::${malformed.join("; ")}`);
  process.exit(1);
}
const isPublished = (manifest) => manifestPublished(readHead(manifest), readBase(base, manifest));
const verdict = checkChangeset({ changed, added, labels, isPublished });
if (verdict.ok) {
  console.log(`changeset check passed: ${verdict.reason}`);
} else {
  console.error(
    `::error title=Changeset missing::This pull request ${verdict.reason}. Run \`nubx changeset\` and commit the file, or add the \`no-release\` label if nothing shipped changes (docs, tests, CI).`,
  );
  process.exit(1);
}
