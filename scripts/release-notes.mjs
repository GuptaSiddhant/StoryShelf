#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Print GitHub Release notes for a tag, taken from CHANGELOG.md.
 *
 * A patch release prints its own section. A minor release (`x.y.0`) rolls up
 * the previous minor line too (every `x.(y-1).*` section), so v0.6.0 carries the
 * whole 0.5.x story. Exits non-zero when the tag has no section, letting the
 * workflow fall back to the git log.
 *
 * Usage:
 *   node scripts/release-notes.mjs v0.6.0
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_URL = "https://github.com/GuptaSiddhant/StoryShelf";
const SECTION_RE = /^## (?<version>\d+\.\d+\.\d+)[^\n]*$/gmu;

function parseSections(markdown) {
  const matches = [...markdown.matchAll(SECTION_RE)];
  return matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? markdown.length;
    return { version: match.groups.version, text: markdown.slice(match.index, end).trim() };
  });
}

function selectSections(sections, version) {
  const [major, minor, patch] = version.split(".").map(Number);
  const own = sections.find((section) => section.version === version);
  if (!own) {
    return [];
  }
  if (patch !== 0 || minor === 0) {
    return [own];
  }
  const rolled = sections.filter((section) => {
    const [maj, min] = section.version.split(".").map(Number);
    return maj === major && min === minor - 1;
  });
  return [own, ...rolled];
}

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/release-notes.mjs <tag>");
  process.exit(2);
}
const version = tag.replace(/^v/u, "");
const changelog = readFileSync(join(import.meta.dirname, "..", "CHANGELOG.md"), "utf8");
const selected = selectSections(parseSections(changelog), version);
if (selected.length === 0) {
  console.error(`no CHANGELOG.md section for ${version}`);
  process.exit(1);
}

const oldest = selected.at(-1).version;
const [major, minor] = version.split(".").map(Number);
const rolledUp = selected.length > 1;
const base = rolledUp ? `v${major}.${minor - 1}.0` : null;
const parts = selected.map((section) => section.text);
if (rolledUp) {
  parts.splice(1, 0, `> Includes the ${major}.${minor - 1}.x releases (${oldest} and later).`);
}
if (base) {
  parts.push(`**Full diff:** ${REPO_URL}/compare/${base}...${tag}`);
}
console.log(`${parts.join("\n\n")}\n`);
