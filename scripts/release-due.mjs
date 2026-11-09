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
 * Nothing is due without pending changesets, or while a release pull request is already open.
 * The bump itself (minor or patch) comes from the changesets, never from the trigger.
 *
 * CLI: node scripts/release-due.mjs <event> — reads MERGED, LABELS (comma-separated), HEAD_REF,
 * OPEN_RELEASE_PRS from the environment and writes `due` and `reason` to $GITHUB_OUTPUT.
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
  if (input.event === "workflow_dispatch") {
    return { due: true, reason: "requested by hand" };
  }
  if (input.event === "pull_request_target") {
    return pullRequestVerdict(input);
  }
  return scheduleVerdict(input);
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

function main() {
  const root = join(import.meta.dirname, "..");
  const verdict = releaseDue({
    event: process.argv[2] ?? "schedule",
    merged: process.env["MERGED"] === "true",
    labels: (process.env["LABELS"] ?? "").split(",").filter(Boolean),
    headRef: process.env["HEAD_REF"] ?? "",
    pending: listPending(join(root, ".changeset")).length,
    openReleasePrs: Number(process.env["OPEN_RELEASE_PRS"] ?? "0"),
    lastMinor: lastMinorDate(root),
    now: new Date(),
  });
  console.log(`[release-due] ${verdict.due ? "due" : "not due"}: ${verdict.reason}`);
  if (process.env["GITHUB_OUTPUT"]) {
    appendFileSync(process.env["GITHUB_OUTPUT"], `due=${verdict.due}\nreason=${verdict.reason}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
