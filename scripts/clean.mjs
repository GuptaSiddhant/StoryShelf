#!/usr/bin/env node
// oxlint-disable no-console
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const cacheOnly = process.argv.includes("--cache-only");

const cacheDirs = [
  ".turbo",
  "node_modules/.cache",
  "node_modules/.vite",
];

const buildDirs = cacheOnly ? [] : [
  "dist",
  "build",
  ".vite",
  ".astro",
  "coverage",
  ".tsbuildinfo",
];

function rm(p) {
  const full = join(root, p);
  if (!existsSync(full)) return false;
  rmSync(full, { recursive: true, force: true });
  console.log(`removed ${p}`);
  return true;
}

let removed = 0;
for (const d of [...cacheDirs, ...buildDirs]) if (rm(d)) removed++;

// packages/apps dist
import { readdirSync } from "node:fs";
for (const base of ["packages", "apps"]) {
  const dir = join(root, base);
  if (!existsSync(dir)) continue;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    for (const sub of (cacheOnly ? cacheDirs : [...cacheDirs, ...buildDirs])) {
      // sub like node_modules/.cache -> join base/entry/sub
      if (rm(join(base, e.name, sub))) removed++;
    }
    // also always clean dist/build at package level even in cache-only? keep consistent with above
    if (!cacheOnly) {
      if (rm(join(base, e.name, "dist"))) removed++;
      if (rm(join(base, e.name, ".turbo"))) removed++;
    }
  }
}

// stop turbo daemon (clears in-memory cache)
const r = spawnSync("npx", ["turbo", "daemon", "clean"], { stdio: "ignore", shell: true });
if (r.status === 0) console.log("turbo daemon cleaned");

if (removed === 0) console.log("nothing to clean");
