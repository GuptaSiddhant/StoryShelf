/**
 * Pure helpers for the release flow (ADR 0043): reading pending changesets, rendering them into the
 * root CHANGELOG.md, and deciding whether a pull request needs a changeset. No I/O except
 * `listPending`; the CLIs (`version-packages.mjs`, `changeset-check.mjs`) call these.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Bump sizes, largest first. */
export const BUMPS = ["major", "minor", "patch"];

const FRONTMATTER = /^---\r?\n(?:(?<head>[\s\S]*?)\r?\n)?---(?:\r?\n(?<body>[\s\S]*))?$/u;
const RELEASE_LINE = /^["']?(?<name>[^"':]+)["']?\s*:\s*(?<bump>major|minor|patch)\s*$/u;
const CHANGESET_FILE = /^\.changeset\/(?!README\.md$)[^/]+\.md$/u;
const UNRELEASED = /^## Unreleased[^\n]*\n/mu;
const VERSION_HEADING = /^## \d+\.\d+\.\d+[^\n]*$/gmu;

/**
 * Parse one changeset file.
 *
 * @param {string} text File contents.
 * @param {string} file Name, for messages and ordering.
 * @returns {{ file: string, releases: { name: string, bump: string }[], body: string }} The parsed changeset.
 */
export function parseChangeset(text, file) {
  const match = FRONTMATTER.exec(text.trim());
  if (!match?.groups) {
    throw new Error(`${file}: a changeset starts with a --- front matter block`);
  }
  return {
    file,
    releases: readReleases(match.groups.head ?? "", file),
    body: (match.groups.body ?? "").trim(),
  };
}

/** The `"package": bump` lines of a front matter block. */
function readReleases(head, file) {
  const releases = [];
  for (const raw of head.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    const release = RELEASE_LINE.exec(line);
    if (!release?.groups) {
      throw new Error(`${file}: cannot read "${line}" (want "package-name": patch|minor|major)`);
    }
    releases.push({ name: release.groups.name.trim(), bump: release.groups.bump });
  }
  return releases;
}

/**
 * The pending changesets in `dir`, in file-name order. An empty changeset (no packages) releases
 * nothing and is skipped.
 *
 * @param {string} dir The `.changeset` directory.
 * @returns {ReturnType<typeof parseChangeset>[]} Changesets that release something.
 */
export function listPending(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .toSorted()
    .map((name) => parseChangeset(readFileSync(join(dir, name), "utf8"), name))
    .filter((changeset) => changeset.releases.length > 0);
}

/**
 * The largest bump in a changeset.
 *
 * @param {{ releases: { bump: string }[] }} changeset The changeset.
 * @returns {number} Index into {@link BUMPS} (0 = major).
 */
function rank(changeset) {
  return Math.min(...changeset.releases.map((release) => BUMPS.indexOf(release.bump)));
}

/**
 * The CHANGELOG entries for some changesets: each body as written, largest bump first, then by file name.
 *
 * @param {ReturnType<typeof parseChangeset>[]} changesets Pending changesets.
 * @returns {string[]} Entry paragraphs (empty bodies are dropped).
 */
export function renderEntries(changesets) {
  return changesets
    .toSorted((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file))
    .map((changeset) => changeset.body)
    .filter((body) => body !== "");
}

/**
 * Put a release into the root CHANGELOG.md. Entries go under `## <version> (<date>)`. A section
 * already written for that version is extended, not duplicated, and the hand-written
 * `## Unreleased` prose is carried into it: it is released with the first Changesets version.
 *
 * @param {string} changelog Current CHANGELOG.md.
 * @param {{ version: string, date: string, entries: string[] }} release What to add.
 * @returns {string} The new CHANGELOG.md.
 */
export function mergeChangelog(changelog, { version, date, entries }) {
  const { text, carried } = takeUnreleased(changelog);
  const added = [...carried, ...entries];
  // With nothing to add, the file still loses an empty `## Unreleased` heading: the release is out.
  return added.length === 0 ? text : insertSection(text, { version, date }, added.join("\n\n"));
}

/** Add `block` under the version's heading: extend the section if it exists, else open one above the newest. */
function insertSection(text, { version, date }, block) {
  const existing = [...text.matchAll(VERSION_HEADING)].find((match) =>
    match[0].startsWith(`## ${version}`),
  );
  if (existing) {
    const at = existing.index + existing[0].length;
    return `${text.slice(0, at)}\n\n${block}${text.slice(at)}`;
  }
  const first = text.search(/^## \d+\.\d+\.\d+/mu);
  const heading = `## ${version} (${date})\n\n${block}\n\n`;
  return first === -1
    ? `${text.trimEnd()}\n\n${heading.trimEnd()}\n`
    : `${text.slice(0, first)}${heading}${text.slice(first)}`;
}

/**
 * Cut the `## Unreleased` section out of a changelog.
 *
 * @param {string} changelog CHANGELOG.md.
 * @returns {{ text: string, carried: string[] }} The rest, and the section's paragraphs.
 */
function takeUnreleased(changelog) {
  const match = UNRELEASED.exec(changelog);
  if (!match) {
    return { text: changelog, carried: [] };
  }
  const start = match.index;
  const bodyStart = start + match[0].length;
  const next = changelog.slice(bodyStart).search(/^## /mu);
  const end = next === -1 ? changelog.length : bodyStart + next;
  const body = changelog.slice(bodyStart, end).trim();
  return {
    text: `${changelog.slice(0, start)}${changelog.slice(end)}`,
    carried: body === "" ? [] : body.split(/\n{2,}/u),
  };
}

/**
 * Test and fixture files carry no shipped behavior. `packages/core/src/test-helpers/` is the
 * exception: core publishes it as `@storyshelf/core/test-helpers`, so changing it is a shipped change.
 */
const NOT_SHIPPED =
  /(?:\.test\.tsx?$|\.integration\.test\.|(?<!^packages\/core\/src)\/test-helpers\/|\/__fixtures__\/|\.d\.ts$)/u;
const SHIPPED_SOURCE = /^packages\/[^/]+\/src\//u;
const PACKAGE_MANIFEST = /^packages\/[^/]+\/package\.json$/u;

/**
 * Whether a pull request must add a changeset: it changes the source of a package or a published
 * manifest, and neither adds a changeset nor carries the `no-release` label.
 *
 * @param {object} input What the PR changes.
 * @param {string[]} input.changed Paths changed by the PR.
 * @param {string[]} input.added Paths the PR adds or modifies.
 * @param {string[]} input.labels The PR's labels.
 * @param {(manifest: string) => boolean} input.isPublished Whether a `packages/x/package.json` is not private.
 * @returns {{ ok: boolean, reason: string }} The verdict and why.
 */
export function checkChangeset({ changed, added, labels, isPublished }) {
  if (labels.includes("no-release")) {
    return { ok: true, reason: "labelled no-release" };
  }
  if (added.some((path) => CHANGESET_FILE.test(path))) {
    return { ok: true, reason: "adds a changeset" };
  }
  const shipped = changed.filter(
    (path) =>
      (SHIPPED_SOURCE.test(path) && !NOT_SHIPPED.test(path)) ||
      (PACKAGE_MANIFEST.test(path) && isPublished(path)),
  );
  if (shipped.length === 0) {
    return { ok: true, reason: "changes no shipped source" };
  }
  return {
    ok: false,
    reason: `changes shipped source (${shipped.slice(0, 5).join(", ")}${shipped.length > 5 ? ", …" : ""}) without a changeset`,
  };
}
