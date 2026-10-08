#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Publish all public workspace packages to npm with OIDC trusted publishing
 * (npm >= 11.5.1 exchanges the workflow OIDC token automatically — no token).
 * Requires a trusted publisher configured per package on npmjs.com (one-time).
 *
 * Versions already on npm are skipped, so the job is safe to re-run.
 *
 * Expects `workspace:*` already rewritten (see rewrite-workspace-protocol.mjs).
 * Order is derived from manifests (see publish-order.mjs).
 *
 * Usage:
 *   node scripts/publish-npm.mjs <version> <dist-tag>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPublishOrder, packagesDir, runPublishStep } from "./publish-order.mjs";

const NPM_REGISTRY = "https://registry.npmjs.org";

/**
 * Whether npm already holds this package version (npm rejects republishing),
 * so a re-run after a partial failure resumes instead of failing on the first
 * package that already went out. A freshly published version can take a few
 * minutes to show up; until then it reads as unpublished, as it did before.
 *
 * @param {string} dir Package directory name.
 * @returns {Promise<boolean>} True when the version is already published.
 */
async function isPublished(dir) {
  const { name, version } = JSON.parse(
    readFileSync(join(packagesDir, dir, "package.json"), "utf8"),
  );
  const response = await fetch(`${NPM_REGISTRY}/${name.replace("/", "%2F")}/${version}`);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`npm version lookup failed for ${name}@${version}: HTTP ${response.status}`);
  }
  return true;
}

const [version, distTag] = process.argv.slice(2);
if (!version || !distTag) {
  console.error("::error::usage: node scripts/publish-npm.mjs <version> <dist-tag>");
  process.exit(1);
}

console.log(`publishing ${version} with dist-tag ${distTag}`);
for (const dir of getPublishOrder()) {
  if (await isPublished(dir)) {
    console.log(`Skipping ${dir} (version already on npm)`);
    continue;
  }
  runPublishStep(
    dir,
    "npm",
    ["publish", "--access", "public", "--provenance", "--tag", distTag],
    "npm",
  );
}
console.log("npm publish complete");
