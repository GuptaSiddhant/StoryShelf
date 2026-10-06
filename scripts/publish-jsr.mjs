#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Publish all public workspace packages to JSR via pinned deno. OIDC auth +
 * provenance attach natively on GitHub Actions (`id-token: write`).
 *
 * Expects `workspace:*` already rewritten (see rewrite-workspace-protocol.mjs)
 * and `deno` 2.6.7 on PATH (Setup Deno step pins it — the tarball path is
 * byte-verified against this version). Order is derived from manifests
 * (see publish-order.mjs).
 *
 * Versions already on JSR are skipped, so the job is safe to re-run.
 *
 * Usage:
 *   node scripts/publish-jsr.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PUBLISH_SCOPE,
  getJsrPublishOrder,
  packagesDir,
  runPublishStep,
} from "./publish-order.mjs";

const JSR_API = "https://api.jsr.io";

const args = [
  "publish",
  // BYONM/sloppy-imports for package.json projects (same set the jsr CLI
  // injects); --no-check skips the redundant typecheck.
  "--unstable-bare-node-builtins",
  "--unstable-sloppy-imports",
  "--unstable-byonm",
  "--no-check",
  // Build regenerates deno.json, leaving the tree dirty.
  "--allow-dirty",
  // Core's zod/drizzle inferred types trip JSR's explicit-type check;
  // documented escape hatch, no-op elsewhere.
  "--allow-slow-types",
];

/**
 * Whether JSR already holds this package version (JSR rejects republishing),
 * so a re-run after a partial failure resumes instead of failing on the
 * first package that already went out.
 *
 * @param {string} dir Package directory name.
 * @returns {Promise<boolean>} True when the version is already published.
 */
async function isPublished(dir) {
  const { version } = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
  const scope = PUBLISH_SCOPE.replace(/^@/u, "");
  const response = await fetch(`${JSR_API}/scopes/${scope}/packages/${dir}/versions/${version}`);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`JSR version lookup failed for ${dir}@${version}: HTTP ${response.status}`);
  }
  return true;
}

for (const dir of getJsrPublishOrder()) {
  if (await isPublished(dir)) {
    console.log(`Skipping ${PUBLISH_SCOPE}/${dir} (version already on JSR)`);
    continue;
  }
  runPublishStep(dir, "deno", args, "deno");
}
console.log("JSR publish complete");
