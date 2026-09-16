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
 * Usage:
 *   node scripts/publish-jsr.mjs
 */
import { getJsrPublishOrder, runPublishStep } from "./publish-order.mjs";

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

for (const dir of getJsrPublishOrder()) {
  runPublishStep(dir, "deno", args, "deno");
}
console.log("JSR publish complete");
