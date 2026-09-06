#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Publish all public workspace packages to JSR via pinned deno. OIDC auth +
 * provenance attach natively on GitHub Actions (`id-token: write`).
 *
 * Expects `workspace:*` already rewritten (see rewrite-workspace-protocol.mjs)
 * and `deno` 2.6.7 on PATH (Setup Deno step pins it — the tarball path is
 * byte-verified against this version).
 *
 * Core first: dependents resolve @storyshelf/core from the registry at
 * publish time, so dependency order is required.
 *
 * Usage:
 *   node scripts/publish-jsr.mjs
 */
import { spawnSync } from "node:child_process";

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

for (const dir of DIRS_IN_PUBLISH_ORDER) {
  console.log(`Publishing ${SCOPE}/${dir}`);
  const result = spawnSync("deno", args, {
    cwd: new URL(`../packages/${dir}/`, import.meta.url).pathname,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`::error::deno publish failed for ${SCOPE}/${dir}`);
    process.exit(result.status ?? 1);
  }
}
console.log("JSR publish complete");
