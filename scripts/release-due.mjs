#!/usr/bin/env node
// oxlint-disable no-console
/**
 * Whether a stable release is due (ADR 0043, owner decisions 2026-11-09). `release-pr.yml` asks this
 * and, when it is due, prepares the release branch and opens the release pull request:
 *
 * - a merged P0 pull request (label `p0-critical`) into `main`;
 * - a merged epic branch (`epic/…`) into `main`;
 * - otherwise, once a day: the last minor release (`vX.Y.0`) is 7 or more days old.
 *
 * Nothing is due without pending changesets. While a release pull request is open, a release is
 * never opened twice: the open one is refreshed when `main` has gained changesets it does not
 * consume (`refresh`), and otherwise left alone. The bump itself (minor or patch) comes from the
 * changesets, never from the trigger; if a refresh changes the version, `refreshOutcome` says to
 * replace the pull request instead of updating its branch.
 *
 * CLI: node scripts/release-due.mjs <event> — reads MERGED, LABELS (comma-separated), HEAD_REF,
 * OPEN_RELEASE_PRS (JSON array of `{ number, ref, sha }`, one per open `release/v*` pull request)
 * from the environment and writes `action` (`open`, `refresh` or `none`), `due`, `reason` and, for
 * a refresh, `open_number`, `open_ref`, `open_sha` to $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listPending } from "./changeset-lib.mjs";

/** Days without a minor release after which the daily check cuts one. */
export const MINOR_INTERVAL_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Decide whether a release is due.
 *
 * @param {object} input What happened and the repository's state.
 * @param {string} input.event `pull_request_target`, `schedule` or `workflow_dispatch`.
 * @param {boolean} [input.merged] For a pull request event: whether it was merged.
 * @param {string[]} [input.labels] For a pull request event: its labels.
 * @param {string} [input.headRef] For a pull request event: its head branch.
 * @param {number} input.pending Pending changesets that release something.
 * @param {number} input.openReleasePrs Open pull requests from `release/v*` branches.
 * @param {number} [input.unconsumed] With one open: pending changesets on `main` its branch does
 *   not consume (they arrived after it was prepared).
 * @param {Date | null} input.lastMinor When the last `vX.Y.0` tag was created, or null for none.
 * @param {Date} input.now The current time.
 * @returns {{ due: boolean, reason: string }} The verdict and why.
 */
export function releaseDue(input) {
  if (input.pending === 0) {
    return { due: false, reason: "no pending changesets" };
  }
  if (input.openReleasePrs > 0) {
    return { due: false, reason: "a release pull request is already open" };
  }
  return triggerVerdict(input);
}

function triggerVerdict(input) {
  if (input.event === "workflow_dispatch") {
    return { due: true, reason: "requested by hand" };
  }
  if (input.event === "pull_request_target") {
    return pullRequestVerdict(input);
  }
  return scheduleVerdict(input);
}

/**
 * What the release workflow does: open a release pull request, refresh the open one, or nothing.
 * A refresh only happens when exactly one release pull request is open and `main` has changesets
 * it does not consume; the trigger does not matter, because the branch is only ever rewritten
 * by the workflow (ADR 0043). More than one open release pull request is left for the owner.
 *
 * @param {Parameters<typeof releaseDue>[0]} input See {@link releaseDue}.
 * @returns {{ action: "open" | "refresh" | "none", due: boolean, reason: string }} The plan.
 */
export function releasePlan(input) {
  if (input.pending > 0 && input.openReleasePrs === 1) {
    if ((input.unconsumed ?? 0) > 0) {
      return { action: "refresh", due: true, reason: "main has changesets the release PR lacks" };
    }
    return { action: "none", due: false, reason: "the open release pull request is current" };
  }
  const verdict = releaseDue(input);
  return { action: verdict.due ? "open" : "none", ...verdict };
}

const stripV = (version) => version.replace(/^v/u, "");

/**
 * After a refresh was prepared: update the open pull request's branch (same version) or replace
 * the pull request (the bump changed, e.g. patch to minor).
 *
 * @param {string} openVersion Version of the open release pull request (`v0.13.1` or `0.13.1`).
 * @param {string} newVersion Version the refreshed release computes.
 * @returns {"update" | "replace"} What to do with the open pull request.
 */
export function refreshOutcome(openVersion, newVersion) {
  return stripV(openVersion) === stripV(newVersion) ? "update" : "replace";
}

function pullRequestVerdict({ merged, labels = [], headRef = "" }) {
  if (!merged) {
    return { due: false, reason: "pull request closed without merging" };
  }
  if (labels.includes("p0-critical")) {
    return { due: true, reason: "a P0 pull request was merged" };
  }
  if (headRef.startsWith("epic/")) {
    return { due: true, reason: `epic ${headRef} was merged` };
  }
  return { due: false, reason: "neither a P0 nor an epic" };
}

function scheduleVerdict({ lastMinor, now }) {
  if (lastMinor === null) {
    return { due: true, reason: "no minor release yet" };
  }
  const days = Math.floor((now.getTime() - lastMinor.getTime()) / DAY_MS);
  if (days >= MINOR_INTERVAL_DAYS) {
    return { due: true, reason: `the last minor release is ${days} days old` };
  }
  return { due: false, reason: `the last minor release is ${days} days old` };
}

/** When the newest `vX.Y.0` tag was created, from git (tags must be fetched). */
function lastMinorDate(root) {
  const out = execFileSync(
    "git",
    [
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname:short) %(creatordate:iso-strict)",
      "refs/tags/v*",
    ],
    { cwd: root, encoding: "utf8" },
  );
  const line = out.split("\n").find((entry) => /^v\d+\.\d+\.0 /u.test(entry));
  return line === undefined ? null : new Date(line.split(" ")[1]);
}

/** Changesets the open release branch deleted (it consumed them) when it was prepared. */
function consumedBy(root, ref) {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=D", `origin/main...origin/${ref}`, "--", ".changeset"],
    { cwd: root, encoding: "utf8" },
  );
  return out.split("\n").map((line) => line.replace(/^\.changeset\//u, ""));
}

/** A changeset file's content at a git revision. */
function changesetAt(root, rev, file) {
  return execFileSync("git", ["show", `${rev}:.changeset/${file}`], {
    cwd: root,
    encoding: "utf8",
  });
}

/**
 * Pending changeset files on `main` that the open release branch did not consume: new files, and
 * consumed ones `main` has edited since the branch was prepared (a bump can change).
 */
function unconsumedCount(root, ref) {
  execFileSync("git", ["fetch", "origin", ref], { cwd: root, stdio: "inherit" });
  const consumed = new Set(consumedBy(root, ref));
  const base = execFileSync("git", ["merge-base", "origin/main", `origin/${ref}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const pending = listPending(join(root, ".changeset")).map((changeset) => changeset.file);
  return pending.filter(
    (file) =>
      !consumed.has(file) ||
      changesetAt(root, base, file) !== changesetAt(root, "origin/main", file),
  ).length;
}

function main() {
  const root = join(import.meta.dirname, "..");
  const open = JSON.parse(process.env["OPEN_RELEASE_PRS"] || "[]");
  const verdict = releasePlan({
    event: process.argv[2] ?? "schedule",
    merged: process.env["MERGED"] === "true",
    labels: (process.env["LABELS"] ?? "").split(",").filter(Boolean),
    headRef: process.env["HEAD_REF"] ?? "",
    pending: listPending(join(root, ".changeset")).length,
    openReleasePrs: open.length,
    unconsumed: open.length === 1 ? unconsumedCount(root, open[0].ref) : 0,
    lastMinor: lastMinorDate(root),
    now: new Date(),
  });
  console.log(`[release-due] ${verdict.action}: ${verdict.reason}`);
  if (process.env["GITHUB_OUTPUT"]) {
    const lines = [`action=${verdict.action}`, `due=${verdict.due}`, `reason=${verdict.reason}`];
    if (verdict.action === "refresh") {
      lines.push(
        `open_number=${open[0].number}`,
        `open_ref=${open[0].ref}`,
        `open_sha=${open[0].sha}`,
      );
    }
    appendFileSync(process.env["GITHUB_OUTPUT"], `${lines.join("\n")}\n`);
  }
}

if (process.argv[1] && process.argv[2] === "--outcome") {
  console.log(refreshOutcome(process.argv[3] ?? "", process.argv[4] ?? ""));
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
