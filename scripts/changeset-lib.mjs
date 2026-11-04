/**
 * Pure helpers for the release flow (ADR 0043): reading pending changesets, choosing and writing the
 * next version, rendering the root CHANGELOG.md, writing a new changeset file, and deciding whether a
 * pull request needs a changeset (or is a release). No I/O except `listPending`; the CLIs
 * (`version-packages.mjs`, `changeset-add.mjs`, `changeset-check.mjs`) call these.
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
 * The largest bump over all the changesets (every package moves by it: they share one version).
 *
 * @param {ReturnType<typeof parseChangeset>[]} changesets Pending changesets.
 * @returns {"major" | "minor" | "patch"} The bump to apply.
 */
export function highestBump(changesets) {
  const largest = Math.min(...changesets.map((changeset) => rank(changeset)));
  return BUMPS[largest] ?? "patch";
}

/**
 * Apply a bump to a plain `major.minor.patch` version (a minor bump of 0.8.0 is 0.9.0, a major one 1.0.0).
 *
 * @param {string} version The shared version.
 * @param {string} bump `major`, `minor` or `patch`.
 * @returns {string} The next version.
 */
export function bumpVersion(version, bump) {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(version);
  if (!match?.groups || !BUMPS.includes(bump)) {
    throw new Error(`cannot apply a ${bump} bump to version "${version}" (want major.minor.patch)`);
  }
  const [major, minor, patch] = [match.groups.major, match.groups.minor, match.groups.patch].map(
    Number,
  );
  if (bump === "major") {
    return `${major + 1}.0.0`;
  }
  return bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/**
 * The package names changesets release that are not published packages of the repository.
 *
 * @param {ReturnType<typeof parseChangeset>[]} changesets Pending changesets.
 * @param {Iterable<string>} known Names of the published packages.
 * @returns {string[]} One message per unknown name (empty when every name is known).
 */
export function unknownReleases(changesets, known) {
  const names = new Set(known);
  return changesets.flatMap((changeset) =>
    changeset.releases
      .filter((release) => !names.has(release.name))
      .map(
        (release) =>
          `${changeset.file}: unknown package "${release.name}" (known: ${[...names].toSorted().join(", ")})`,
      ),
  );
}

/** The body a new changeset starts with when no message is given: CI rejects a changeset that keeps it. */
export const PLACEHOLDER_BODY =
  "Describe what a user sees, starting with a bold lead (**Fixed: …**, **Added: …**, **Changed: …** or **Breaking: …**) and the issue numbers.";

/**
 * The text of a new changeset file.
 *
 * @param {object} input What the changeset says.
 * @param {string[]} input.packages Package names it releases.
 * @param {string} input.bump `major`, `minor` or `patch`.
 * @param {string} [input.message] The CHANGELOG entry (the placeholder when absent).
 * @returns {string} The file contents.
 */
export function renderChangeset({ packages, bump, message }) {
  if (!BUMPS.includes(bump)) {
    throw new Error(`unknown bump "${bump}" (want ${BUMPS.join(", ")})`);
  }
  if (packages.length === 0) {
    throw new Error("a changeset names at least one package");
  }
  const lines = packages.map((name) => `"${name}": ${bump}`);
  const body = message?.trim() ? message.trim() : PLACEHOLDER_BODY;
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

const WORDS = {
  adjectives: [
    "brave",
    "calm",
    "eager",
    "fair",
    "gentle",
    "happy",
    "kind",
    "lucky",
    "proud",
    "quiet",
    "silly",
    "witty",
  ],
  nouns: [
    "apples",
    "bears",
    "clouds",
    "dogs",
    "eagles",
    "foxes",
    "geese",
    "hills",
    "lions",
    "moons",
    "otters",
    "pandas",
  ],
  verbs: [
    "dance",
    "glow",
    "hum",
    "jump",
    "laugh",
    "listen",
    "run",
    "shine",
    "sing",
    "sleep",
    "smile",
    "wave",
  ],
};

/**
 * A new changeset file name made of three words (`brave-otters-sing`), free of `taken` ones.
 *
 * @param {(max: number) => number} random Returns an integer in `[0, max)`.
 * @param {(name: string) => boolean} taken Whether a file of that name already exists.
 * @returns {string} A name without the `.md` extension.
 */
export function changesetName(random, taken) {
  const pick = (list) => list[random(list.length)];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = `${pick(WORDS.adjectives)}-${pick(WORDS.nouns)}-${pick(WORDS.verbs)}`;
    if (!taken(name)) {
      return name;
    }
  }
  throw new Error("could not find a free changeset name");
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
 * Whether a package manifest ships: it counts when it was published before or after the change, so
 * making a package private or deleting it (which changes what ships) still needs a changeset.
 *
 * @param {...(string | null)} texts The manifest's contents on each side of the change; null when absent.
 * @returns {boolean} True when any side parses to a manifest that is not `private`.
 */
export function manifestPublished(...texts) {
  return texts.some((text) => {
    if (text === null) {
      return false;
    }
    try {
      return JSON.parse(text).private !== true;
    } catch {
      return false;
    }
  });
}

/**
 * The problems in the changesets a pull request adds, so a malformed file fails the pull request
 * and not the first run on `main` that reads it: bad front matter, the placeholder text, and (when
 * `known` is given) a package that is not published here, which `version-packages.mjs` refuses.
 *
 * @param {string[]} added Paths the PR adds or modifies.
 * @param {(path: string) => string} read Reads a file from the PR's tree.
 * @param {Iterable<string>} [known] Names of the published packages; unknown names are not checked without it.
 * @returns {string[]} One message per problem.
 */
export function malformedChangesets(added, read, known) {
  const problems = [];
  for (const path of added.filter((entry) => CHANGESET_FILE.test(entry))) {
    try {
      const parsed = parseChangeset(read(path), path);
      if (parsed.body === PLACEHOLDER_BODY) {
        problems.push(`${path}: replace the placeholder text with the CHANGELOG entry`);
      }
      if (known !== undefined) {
        problems.push(...unknownReleases([parsed], known));
      }
    } catch (error) {
      problems.push(error.message);
    }
  }
  return problems;
}

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

const RELEASE_BRANCH = /^release\/v(?<version>\d+\.\d+\.\d+)$/u;

/**
 * The version a release branch names.
 *
 * @param {string | undefined} headRef The pull request's head branch.
 * @returns {string | null} `1.2.3` for `release/v1.2.3`, else null.
 */
export function releaseBranchVersion(headRef) {
  return RELEASE_BRANCH.exec(headRef ?? "")?.groups?.version ?? null;
}

/** Why a changed manifest is not a pure version bump to `version`, or null when it is one. */
function manifestProblem(path, version, base, head) {
  let before;
  let after;
  try {
    before = JSON.parse(base ?? "");
    after = JSON.parse(head ?? "");
  } catch {
    return `${path} cannot be read on both sides`;
  }
  if (after.version !== version) {
    return `${path} is at ${after.version}, not ${version}`;
  }
  return JSON.stringify({ ...before, version }) === JSON.stringify(after)
    ? null
    : `${path} changes more than its version`;
}

/**
 * What a release pull request (branch `release/v<version>`) may change: the `version` of package
 * manifests, `CHANGELOG.md`, and the changesets it consumes (deleted). Anything else is a problem,
 * so the branch name cannot be used to skip the changeset check. Every published manifest must also
 * be at `version`, changed or not, so a package left behind cannot ship a mixed release.
 *
 * @param {object} input The pull request.
 * @param {string} input.version The version the branch names.
 * @param {{ status: string, path: string }[]} input.entries Changed paths with their git status letter.
 * @param {(path: string) => string | null} input.readBase A file at the base (null when absent).
 * @param {(path: string) => string | null} input.readHead A file at the head (null when absent).
 * @param {string[]} [input.published] Paths of the published packages' manifests at the head.
 * @returns {string[]} One message per problem (empty for a valid release pull request).
 */
export function releaseProblems({ version, entries, readBase, readHead, published = [] }) {
  const changed = new Set(entries.map(({ path }) => path));
  return [
    ...entries.map(({ status, path }) =>
      entryProblem({ status, path, version, readBase, readHead }),
    ),
    ...published
      .filter((path) => !changed.has(path))
      .map((path) => staleManifestProblem(path, version, readHead(path))),
  ].filter((problem) => problem !== null);
}

/** Why a published manifest the release did not touch is not at `version`, or null when it is. */
function staleManifestProblem(path, version, head) {
  try {
    const current = JSON.parse(head ?? "").version;
    return current === version ? null : `${path} is still at ${current}, not ${version}`;
  } catch {
    return `${path} cannot be read`;
  }
}

/** Why one changed path is not part of a release, or null when it is. */
function entryProblem({ status, path, version, readBase, readHead }) {
  if (path === "CHANGELOG.md") {
    return null;
  }
  if (CHANGESET_FILE.test(path)) {
    return status === "D" ? null : `${path} must be deleted by a release, not changed`;
  }
  if (PACKAGE_MANIFEST.test(path)) {
    return manifestProblem(path, version, readBase(path), readHead(path));
  }
  return `${path} is not part of a release`;
}
