#!/usr/bin/env node
// oxlint-disable max-statements max-lines-per-function no-console complexity
/**
 * Prune nub.lock to match the (already pruned) working directory.
 *
 * Usage AFTER `turbo prune --docker`:
 *   turbo prune fly-app --docker --out-dir out
 *   node scripts/prune-nub-lock.mjs out/json   # or out/full, or any pruned dir
 *   node scripts/prune-nub-lock.mjs out         # handles out/json + out/full
 *
 * Scope-agnostic: discovers kept workspaces by scanning for all
 * package.json files in the given directory. If a trimmed pnpm-lock.yaml
 * is present (because you did `cp nub.lock pnpm-lock.yaml` before pruning),
 * it is copied to nub.lock — this reuses turbo's native pnpm pruning (fast
 * path, no custom parsing). Otherwise, nub.lock is trimmed by filtering
 * importers and BFS on reachable packages.
 */

import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const require = createRequire(import.meta.url);

// --- arg parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  let dir = null;
  let verbose = false;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--verbose" || a === "-v") verbose = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--out-dir" && args[i + 1]) {
      dir = args[i + 1];
      i += 1;
    } else if (a.startsWith("--out-dir=")) {
      dir = a.split("=")[1];
    } else if (!a.startsWith("-") && dir === null) {
      dir = a;
    }
  }
  if (!dir) dir = ".";
  return { dir: resolve(dir), verbose, dryRun, help };
}

// --- filesystem discovery (no glob dependency) ---

function walkPackageJson(dir, outDir, keys) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (
      e.name === "node_modules" ||
      e.name === "dist" ||
      e.name === ".turbo" ||
      e.name === ".cache" ||
      e.name === ".git"
    )
      continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkPackageJson(full, outDir, keys);
    } else if (e.name === "package.json") {
      const rel = relative(outDir, dirname(full)).replaceAll("\\", "/");
      const key = rel === "" ? "." : rel;
      keys.add(key);
    }
  }
}

function discoverImporters(outDir) {
  const keys = new Set();
  walkPackageJson(outDir, outDir, keys);
  return keys;
}

function stripPeerSuffix(version) {
  const idx = version.indexOf("(");
  return idx === -1 ? version : version.slice(0, idx);
}

function collectReachablePackages(newImporters, allPackages) {
  const keep = new Set();
  const queue = [];
  const pkgKeys = Object.keys(allPackages);

  function addPackage(name, version) {
    const base = stripPeerSuffix(version);
    const key1 = `${name}@${base}`;
    if (allPackages[key1] && !keep.has(key1)) {
      keep.add(key1);
      queue.push(key1);
      return;
    }
    for (const k of pkgKeys) {
      if (k === key1 || k.startsWith(`${key1}(`)) {
        if (!keep.has(k)) {
          keep.add(k);
          queue.push(k);
        }
      }
    }
  }

  for (const imp of Object.values(newImporters)) {
    for (const deps of [imp.dependencies, imp.devDependencies, imp.optionalDependencies]) {
      if (!deps) continue;
      for (const [name, meta] of Object.entries(deps)) {
        if (!meta || typeof meta.version !== "string") continue;
        const v = meta.version;
        if (v.startsWith("link:")) continue;
        addPackage(name, v);
      }
    }
  }

  while (queue.length > 0) {
    const key = queue.pop();
    const pkg = allPackages[key];
    if (!pkg) continue;
    for (const deps of [pkg.dependencies, pkg.optionalDependencies, pkg.peerDependencies]) {
      if (!deps) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec !== "string" || spec === "*") continue;
        addPackage(name, spec);
      }
    }
  }
  return keep;
}

// --- single directory processing ---

function processSingleDir(dir, verbose, dryRun) {
  const pnpmLock = join(dir, "pnpm-lock.yaml");
  const nubLock = join(dir, "nub.lock");

  // Fast path: turbo already pruned pnpm-lock.yaml (trick) — reuse it
  if (existsSync(pnpmLock) && existsSync(nubLock)) {
    const pnpmRaw = readFileSync(pnpmLock, "utf8");
    const nubRaw = readFileSync(nubLock, "utf8");
    if (pnpmRaw !== nubRaw) {
      if (!dryRun) writeFileSync(nubLock, pnpmRaw);
      if (verbose)
        console.log(
          `[prune] trick: copied pruned pnpm-lock.yaml → nub.lock in ${relative(process.cwd(), dir)} (${pnpmRaw.length} bytes)`,
        );
      return true;
    }
    if (verbose)
      console.log(
        `[prune] trick: pnpm-lock.yaml already equals nub.lock in ${relative(process.cwd(), dir)} — no-op`,
      );
    return false;
  }
  if (existsSync(pnpmLock) && !existsSync(nubLock)) {
    if (!dryRun) cpSync(pnpmLock, nubLock);
    if (verbose)
      console.log(
        `[prune] trick: created nub.lock from pnpm-lock.yaml in ${relative(process.cwd(), dir)}`,
      );
    return true;
  }

  // Fallback: manual discovery-based trimming
  if (existsSync(nubLock)) {
    let yaml;
    try {
      yaml = require("yaml");
    } catch {
      try {
        yaml = require(join(process.cwd(), "node_modules", "yaml"));
      } catch {
        if (verbose) console.log("[prune] yaml not available — cannot fallback trim");
        return false;
      }
    }
    const raw = readFileSync(nubLock, "utf8");
    let lock;
    try {
      lock = yaml.parse(raw);
    } catch (e) {
      console.error(`[prune] failed to parse ${nubLock}: ${e.message}`);
      return false;
    }
    if (!lock.importers) return false;
    const keptKeys = discoverImporters(dir);
    if (keptKeys.size === 0) {
      if (verbose) console.log(`[prune] no package.json found in ${dir} — skipping`);
      return false;
    }
    const originalImporterCount = Object.keys(lock.importers).length;
    const originalPackageCount = lock.packages ? Object.keys(lock.packages).length : 0;

    const newImporters = {};
    for (const k of keptKeys) {
      if (lock.importers[k]) newImporters[k] = lock.importers[k];
    }
    if (Object.keys(newImporters).length === 0) {
      if (verbose) console.log(`[prune] no matching importers for ${dir} — keeping lock as-is`);
      return false;
    }
    if (Object.keys(newImporters).length === originalImporterCount) {
      if (verbose) console.log(`[prune] importers unchanged (${originalImporterCount}) — skipping`);
      return false;
    }

    // Fallback keeps all packages — only importers are trimmed. This is
    // safe (nub tolerates extra packages) and avoids under-trimming bugs.
    // The pnpm trick (above) already does correct package BFS via turbo.
    const newPackages = lock.packages;

    const pruned = {
      lockfileVersion: lock.lockfileVersion,
      settings: lock.settings,
      catalogs: lock.catalogs,
      importers: newImporters,
      packages: newPackages,
    };
    for (const [k, v] of Object.entries(lock)) {
      if (!(k in pruned)) pruned[k] = v;
    }
    const out = yaml.stringify(pruned);
    if (dryRun) {
      console.log(
        `[prune] dry-run ${relative(process.cwd(), dir)}: importers ${originalImporterCount}→${Object.keys(newImporters).length}, packages ${originalPackageCount}→${Object.keys(newPackages ?? {}).length}`,
      );
      return true;
    }
    writeFileSync(nubLock, out);
    if (verbose)
      console.log(
        `[prune] fallback: trimmed ${relative(process.cwd(), nubLock)} importers ${originalImporterCount}→${Object.keys(newImporters).length}, packages ${originalPackageCount}→${Object.keys(newPackages).length}`,
      );
    return true;
  }

  if (verbose) console.log(`[prune] no lockfile in ${relative(process.cwd(), dir)} — skipping`);
  return false;
}

function pruneDir(targetDir, verbose, dryRun) {
  const abs = resolve(targetDir);
  const hasJson =
    existsSync(join(abs, "json", "package.json")) ||
    existsSync(join(abs, "json", "pnpm-lock.yaml")) ||
    existsSync(join(abs, "json", "nub.lock"));
  const hasFull = existsSync(join(abs, "full", "package.json"));
  if (hasJson || hasFull) {
    let did = false;
    if (hasJson) did = processSingleDir(join(abs, "json"), verbose, dryRun) || did;
    if (hasFull) did = processSingleDir(join(abs, "full"), verbose, dryRun) || did;
    if (existsSync(join(abs, "pnpm-lock.yaml")) && existsSync(join(abs, "nub.lock"))) {
      const p = readFileSync(join(abs, "pnpm-lock.yaml"), "utf8");
      const n = readFileSync(join(abs, "nub.lock"), "utf8");
      if (p !== n && !dryRun) writeFileSync(join(abs, "nub.lock"), p);
      if (verbose && p !== n)
        console.log(
          `[prune] synced ${relative(process.cwd(), join(abs, "pnpm-lock.yaml"))} → nub.lock`,
        );
      did = did || p !== n;
    }
    return did;
  }
  return processSingleDir(abs, verbose, dryRun);
}

// --- main ---

const { dir, verbose, dryRun, help } = parseArgs(process.argv);
if (help) {
  console.log(`Usage: node scripts/prune-nub-lock.mjs [outDir] [--verbose] [--dry-run]

Prunes nub.lock in <outDir> to match the package.json workspaces actually
present there. Designed to run after \`turbo prune --docker\`.

  turbo prune fly-app --docker --out-dir out
  node scripts/prune-nub-lock.mjs out/json        # pnpm trick (fast)
  node scripts/prune-nub-lock.mjs out             # handles out/json + out/full

If outDir/json/pnpm-lock.yaml exists (because you did \`cp nub.lock pnpm-lock.yaml\`
before pruning), it is copied to nub.lock — this reuses turbo's native pnpm
 pruning and avoids custom parsing. Otherwise, nub.lock is trimmed by scanning
 for all package.json files and BFS on reachable packages.
`);
  process.exit(0);
}

const didWork = pruneDir(dir, verbose, dryRun);
if (!didWork && verbose) console.log(`[prune] nothing to do for ${relative(process.cwd(), dir)}`);
