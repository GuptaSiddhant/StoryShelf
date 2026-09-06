#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Publish all public workspace packages to npm with OIDC trusted publishing
 * (npm >= 11.5.1 exchanges the workflow OIDC token automatically — no token).
 * Requires a trusted publisher configured per package on npmjs.com (one-time).
 *
 * Expects `workspace:*` already rewritten (see rewrite-workspace-protocol.mjs).
 *
 * Usage:
 *   node scripts/publish-npm.mjs <version> <dist-tag>
 */
import { execSync, spawnSync } from "node:child_process";

const SCOPE = "@storyshelf";
const DIRS_IN_PUBLISH_ORDER = [
  "core",
  "auth-oauth",
  "auth-password",
  "db-sqlite",
  "db-turso",
  "queue-sqs",
  "runner-playwright",
  "storage-local",
  "storage-s3",
  "cli",
  "git-github",
  "git-gitlab",
];

const [version, distTag] = process.argv.slice(2);
if (!version || !distTag) {
  console.error("::error::usage: node scripts/publish-npm.mjs <version> <dist-tag>");
  process.exit(1);
}

console.log(`publishing ${version} with dist-tag ${distTag}`);
for (const dir of DIRS_IN_PUBLISH_ORDER) {
  console.log(`Publishing ${SCOPE}/${dir}`);
  const result = spawnSync("npm", ["publish", "--access", "public", "--provenance", "--tag", distTag], {
    cwd: new URL(`../packages/${dir}/`, import.meta.url).pathname,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`::error::npm publish failed for ${SCOPE}/${dir}`);
    process.exit(result.status ?? 1);
  }
}

// Verify the published version resolves on the registry.
const resolved = execSync(`npm view ${SCOPE}/core@${version} version`, { encoding: "utf8" }).trim();
if (resolved !== version) {
  console.error(`::error::registry shows ${resolved}, expected ${version}`);
  process.exit(1);
}
console.log(`verified ${SCOPE}/core@${version} on registry`);
