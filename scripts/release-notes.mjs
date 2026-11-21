#!/usr/bin/env node
// oxlint-disable no-console
/**
 * Print GitHub Release notes for a tag, taken from CHANGELOG.md (ADR 0043, amendment 2026-11-09
 * "short release notes"): the tag's own section in its short form (`shortNotes`: each kind's
 * one-line summaries, internal entries counted), then links to the full section and the diff from
 * the previous release, then an Install section (#1271): the npm packages and container images the
 * release published. Exits non-zero when the tag has no section, letting the workflow fall back to
 * the git log; `--install-only` prints just the Install section for that fallback.
 *
 * Usage:
 *   node scripts/release-notes.mjs v0.11.0 [--dockerhub] [--install-only]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { shortNotes } from "./changelog-entry.mjs";

const REPO_URL = "https://github.com/GuptaSiddhant/StoryShelf";
const SITE_URL = "https://storyshelf.js.org";
const PACKAGES_DIR = join(import.meta.dirname, "..", "packages");
const FIRST = ["storyshelf", "@storyshelf/app"];
const SECTION_RE = /^## (?<version>\d+\.\d+\.\d+)[^\n]*$/gmu;

/**
 * The release notes for one version.
 *
 * @param {string} changelog CHANGELOG.md.
 * @param {string} tag The release tag, `v<version>`.
 * @param {InstallOptions} [install] What the Install section lists; omitted, there is none.
 * @returns {string | null} The notes, or null when the changelog has no section for the tag.
 */
export function releaseNotes(changelog, tag, install) {
  const matches = [...changelog.matchAll(SECTION_RE)];
  const at = matches.findIndex((match) => `v${match.groups?.["version"]}` === tag);
  if (at === -1) {
    return null;
  }
  const [own, next] = [matches[at], matches[at + 1]];
  const body = changelog.slice(own.index + own[0].length, next?.index ?? changelog.length);
  const notes = `${shortNotes(body)}\n\n${links(tag, own[0], next?.groups?.["version"]).join("\n")}\n`;
  return install === undefined ? notes : `${notes}\n${installSection(tag, install)}`;
}

/**
 * @typedef {object} InstallOptions
 * @property {{ name: string }[]} packages The packages the release published.
 * @property {boolean} [dockerhub] Whether the image was also pushed to Docker Hub.
 */

function rank(name) {
  return FIRST.includes(name) ? FIRST.indexOf(name) : FIRST.length;
}

/**
 * The published npm packages: every public workspace manifest, the set `publish-npm` ships (not
 * private, with a name), so a deleted package drops out by itself. The CLI and the app come first.
 *
 * @param {string} [dir] The workspace `packages/` directory.
 * @returns {{ name: string }[]} The packages, in listing order.
 */
export function publishedPackages(dir = PACKAGES_DIR) {
  const names = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, entry.name, "package.json"), "utf8"));
      if (pkg.private !== true && pkg.name) {
        names.push(pkg.name);
      }
    } catch {
      // Not a package directory.
    }
  }
  return names
    .toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => ({ name }));
}

/**
 * The Install section: npm packages, container images and docs links.
 *
 * @param {string} tag The release tag, `v<version>`.
 * @param {InstallOptions} options What was published.
 * @returns {string} Markdown ending in a newline.
 */
export function installSection(tag, { packages, dockerhub = false }) {
  const version = tag.replace(/^v/u, "");
  const npm = packages.map(
    ({ name }) => `- [\`${name}@${version}\`](https://www.npmjs.com/package/${name}/v/${version})`,
  );
  const { images, pulls } = imageLines(version, dockerhub);
  return [
    "## Install",
    "",
    "**npm**",
    "",
    ...npm,
    "",
    "**Container images**",
    "",
    ...images,
    "",
    "```sh",
    ...pulls,
    "```",
    "",
    `**Docs:** [Getting started](${SITE_URL}/guides/getting-started/)`,
    "",
  ].join("\n");
}

/** The linked image tags and their `docker pull` lines; Docker Hub only when it was pushed. */
function imageLines(version, dockerhub) {
  const tags = [version, `${version}-hosting`];
  const registries = [
    { image: "ghcr.io/guptasiddhant/storyshelf", page: `${REPO_URL}/pkgs/container/storyshelf` },
    ...(dockerhub
      ? [
          {
            image: "guptasiddhant/storyshelf",
            page: "https://hub.docker.com/r/guptasiddhant/storyshelf/tags",
          },
        ]
      : []),
  ];
  const refs = registries.flatMap(({ image, page }) =>
    tags.map((tag) => ({ ref: `${image}:${tag}`, page })),
  );
  return {
    images: refs.map(({ ref, page }) => `- [\`${ref}\`](${page})`),
    pulls: refs.map(({ ref }) => `docker pull ${ref}`),
  };
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
  const [tag, ...flags] = process.argv.slice(2);
  if (!tag) {
    console.error("usage: node scripts/release-notes.mjs <tag> [--dockerhub] [--install-only]");
    process.exit(2);
  }
  const install = { packages: publishedPackages(), dockerhub: flags.includes("--dockerhub") };
  process.stdout.write(
    flags.includes("--install-only") ? installSection(tag, install) : notesOrExit(tag, install),
  );
}

/** The release notes for the tag, or exit 1 so the workflow falls back to the git log. */
function notesOrExit(tag, install) {
  const changelog = readFileSync(join(import.meta.dirname, "..", "CHANGELOG.md"), "utf8");
  const notes = releaseNotes(changelog, tag, install);
  if (notes === null) {
    console.error(`no CHANGELOG.md section for ${tag}`);
    process.exit(1);
  }
  return notes;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
