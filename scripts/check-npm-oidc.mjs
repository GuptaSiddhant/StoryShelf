#!/usr/bin/env node
// oxlint-disable no-console
/**
 * Gate npm OIDC trusted publishing on npm >= 11.5.1 (first version with
 * OIDC auto-detection). Fails fast with an actionable error otherwise.
 *
 * Usage:
 *   node scripts/check-npm-oidc.mjs
 */
import { execSync } from "node:child_process";

const version = execSync("npm --version", { encoding: "utf8" }).trim();
console.log(`npm version: ${version}`);
const [major, minor] = version.split(".").map(Number);
if (major < 11 || (major === 11 && minor < 5)) {
  console.error(`::error::npm >= 11.5.1 required for OIDC trusted publishing, found ${version}`);
  process.exit(1);
}
console.log("npm OIDC supported");
