#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Publish all public workspace packages to npm with OIDC trusted publishing
 * (npm >= 11.5.1 exchanges the workflow OIDC token automatically — no token).
 * Requires a trusted publisher configured per package on npmjs.com (one-time).
 *
 * Expects `workspace:*` already rewritten (see rewrite-workspace-protocol.mjs).
 * Order is derived from manifests (see publish-order.mjs).
 *
 * Usage:
 *   node scripts/publish-npm.mjs <version> <dist-tag>
 */
import { execSync } from "node:child_process";
import { PUBLISH_SCOPE, getPublishOrder, runPublishStep } from "./publish-order.mjs";

const [version, distTag] = process.argv.slice(2);
if (!version || !distTag) {
  console.error("::error::usage: node scripts/publish-npm.mjs <version> <dist-tag>");
  process.exit(1);
}

console.log(`publishing ${version} with dist-tag ${distTag}`);
for (const dir of getPublishOrder()) {
  runPublishStep(dir, "npm", ["publish", "--access", "public", "--provenance", "--tag", distTag], "npm");
}

// Verify the published version resolves on the registry.
const resolved = execSync(`npm view ${PUBLISH_SCOPE}/core@${version} version`, {
  encoding: "utf8",
}).trim();
if (resolved !== version) {
  console.error(`::error::registry shows ${resolved}, expected ${version}`);
  process.exit(1);
}
console.log(`verified ${PUBLISH_SCOPE}/core@${version} on registry`);
