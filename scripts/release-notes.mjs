#!/usr/bin/env node
// oxlint-disable no-console
/**
 * Print GitHub Release notes for a tag, taken from CHANGELOG.md (ADR 0043, amendment 2026-11-09
 * "short release notes"): the tag's own section in its short form (`shortNotes`: each kind's
 * one-line summaries, internal entries counted), then links to the full section and the diff from
 * the previous release. Exits non-zero when the tag has no section, letting the workflow fall back
 * to the git log.
 *
 * Usage:
 *   node scripts/release-notes.mjs v0.11.0
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { shortNotes } from "./changelog-entry.mjs";

const REPO_URL = "https://github.com/GuptaSiddhant/StoryShelf";
const SECTION_RE = /^## (?<version>\d+\.\d+\.\d+)[^\n]*$/gmu;

/**
 * The release notes for one version.
 *
 * @param {string} changelog CHANGELOG.md.
 * @param {string} tag The release tag, `v<version>`.
 * @returns {string | null} The notes, or null when the changelog has no section for the tag.
 */
export function releaseNotes(changelog, tag) {
  const matches = [...changelog.matchAll(SECTION_RE)];
  const at = matches.findIndex((match) => `v${match.groups?.["version"]}` === tag);
  if (at === -1) {
    return null;
  }
  const [own, next] = [matches[at], matches[at + 1]];
  const body = changelog.slice(own.index + own[0].length, next?.index ?? changelog.length);
  return `${shortNotes(body)}\n\n${links(tag, own[0], next?.groups?.["version"]).join("\n")}\n`;
}

/** The links under the notes: the full section, and the diff from the previous release. */
function links(tag, heading, previous) {
  const details = `**Details:** ${REPO_URL}/blob/${tag}/CHANGELOG.md#${anchor(heading)}`;
  return previous === undefined
    ? [details]
    : [details, `**Full diff:** ${REPO_URL}/compare/v${previous}...${tag}`];
}

/** GitHub's anchor for a Markdown heading. */
function anchor(heading) {
  return heading
    .replace(/^#+\s*/u, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .replaceAll(/\s/gu, "-");
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error("usage: node scripts/release-notes.mjs <tag>");
    process.exit(2);
  }
  const changelog = readFileSync(join(import.meta.dirname, "..", "CHANGELOG.md"), "utf8");
  const notes = releaseNotes(changelog, tag);
  if (notes === null) {
    console.error(`no CHANGELOG.md section for ${tag}`);
    process.exit(1);
  }
  process.stdout.write(notes);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
