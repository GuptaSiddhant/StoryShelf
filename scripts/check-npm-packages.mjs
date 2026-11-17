#!/usr/bin/env node
// oxlint-disable max-statements curly no-console no-process-exit
/**
 * Release dry run (#1097): every public workspace package must already exist on npm.
 *
 * A package that does not exist is a new one. npm trusted publishing is configured per existing
 * package, so a first publish cannot go through `release.yml` (it ends in ENEEDAUTH). This check
 * fails the release pull request with the steps instead, before the owner merges it.
 *
 * With `--trust` (and an npm token in the environment, which is never printed) it also reads each
 * package's trusted publisher with `npm trust list`, as `npm-trust-all.mjs` does.
 *
 * Usage:
 *   node scripts/check-npm-packages.mjs [--trust] [<package> ...]
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getPublicPackageNames } from "./public-packages.mjs";

const NPM_REGISTRY = "https://registry.npmjs.org";
const REPOSITORY = "GuptaSiddhant/StoryShelf";
const WORKFLOW = "release.yml";
const CONFIG_OBJECT_RE = /\{[^{}]*\}/gu;

/**
 * Whether npm holds the package.
 *
 * @param {string} name Package name.
 * @param {typeof fetch} fetchFn Injected for tests.
 * @returns {Promise<boolean>} False on a 404; any other failure throws.
 */
export async function existsOnNpm(name, fetchFn = fetch) {
  const response = await fetchFn(`${NPM_REGISTRY}/${name.replace("/", "%2F")}`, {
    method: "HEAD",
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`npm lookup failed for ${name}: HTTP ${response.status}`);
  return true;
}

/**
 * Whether `npm trust list` shows this repository's release workflow for the package.
 *
 * @param {string} output Text from `npm trust list <name> --json` (one object per config).
 * @returns {boolean} True when a matching trusted publisher exists.
 */
export function hasTrustedPublisher(output) {
  return (output.match(CONFIG_OBJECT_RE) ?? []).some((raw) => {
    try {
      const config = JSON.parse(raw);
      return config.repository === REPOSITORY && config.file === WORKFLOW;
    } catch {
      return false;
    }
  });
}

/**
 * The first-publish instructions for packages npm does not know.
 *
 * @param {string[]} missing Package names absent from npm.
 * @returns {string} A message for the job log.
 */
export function firstPublishHelp(missing) {
  const list = missing.map((name) => `  - ${name}`).join("\n");
  return `These packages are not on npm yet:\n${list}\n
A first publish cannot use trusted publishing (npm configures it per existing package), so
release.yml would fail with ENEEDAUTH. Before merging this release pull request, for each package:
  1. Build it and publish once by hand, signed in as an owner of the @storyshelf scope:
       npm publish --access public   (from the package directory, after nub run build)
  2. Add its trusted publisher (GitHub Actions, ${REPOSITORY}, ${WORKFLOW}):
       node scripts/npm-trust-all.mjs --package <name>
Then re-run this check.`;
}

function trustList(name) {
  try {
    return execFileSync("npm", ["trust", "list", name, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
  } catch {
    return null;
  }
}

/**
 * Check the packages.
 *
 * @param {string[]} names Packages to check.
 * @param {{ trust?: boolean, fetchFn?: typeof fetch, trustFn?: (name: string) => string | null }} options
 * @returns {Promise<{ missing: string[], untrusted: string[] }>} What failed.
 */
export async function checkPackages(
  names,
  { trust = false, fetchFn = fetch, trustFn = trustList } = {},
) {
  const missing = [];
  const untrusted = [];
  for (const name of names) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time, politely
    const exists = await existsOnNpm(name, fetchFn);
    console.log(`${exists ? "ok     " : "MISSING"} ${name}`);
    if (!exists) missing.push(name);
    else if (trust) {
      const listed = trustFn(name);
      // A failed read (a token that cannot list trust configs) is unknown, not untrusted.
      if (listed === null)
        console.log(`::warning::Could not read the trusted publisher of ${name}`);
      else if (!hasTrustedPublisher(listed)) untrusted.push(name);
    }
  }
  return { missing, untrusted };
}

async function main() {
  const args = process.argv.slice(2);
  const trust = args.includes("--trust");
  const requested = args.filter((arg) => !arg.startsWith("-"));
  const names = requested.length > 0 ? requested : getPublicPackageNames();
  const { missing, untrusted } = await checkPackages(names, { trust });
  if (missing.length > 0) console.error(`::error::${firstPublishHelp(missing)}`);
  if (untrusted.length > 0) {
    console.error(
      `::error::No trusted publisher for ${WORKFLOW} on: ${untrusted.join(", ")}. Run node scripts/npm-trust-all.mjs.`,
    );
  }
  if (missing.length + untrusted.length > 0) process.exit(1);
  console.log(`${names.length} packages exist on npm${trust ? " with a trusted publisher" : ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
