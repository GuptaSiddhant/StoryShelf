#!/usr/bin/env node
/** Give public packages the same commit-based version pkg.pr.new uses when packing. */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function previewVersion(sha) {
  if (!/^[\da-f]{40}$/iu.test(sha)) throw new Error("Expected a full Git commit SHA");
  return `0.0.0-preview-${sha.slice(0, 7).toLowerCase()}`;
}

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeManifest(path, pkg) {
  const temporary = `${path}.preview-${process.pid}`;
  let created = false;
  try {
    writeFileSync(temporary, `${JSON.stringify(pkg, null, 2)}\n`, { flag: "wx" });
    created = true;
    renameSync(temporary, path);
  } finally {
    if (created) rmSync(temporary, { force: true });
  }
}

function stampOne(path, version) {
  const pkg = readManifest(path);
  if (!pkg || pkg.private === true || !pkg.name) return false;
  if (typeof pkg.version !== "string") throw new Error(`Missing version in ${path}`);
  pkg.version = version;
  writeManifest(path, pkg);
  return true;
}

/** Run only in a disposable publishing checkout, after dependency installation. */
export function stampPreviewPackages(packagesDir, version) {
  if (!/^0\.0\.0-preview-[\da-f]{7}$/u.test(version)) throw new Error("Invalid preview version");
  let count = 0;
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && stampOne(join(packagesDir, entry.name, "package.json"), version)) {
      count += 1;
    }
  }
  if (count === 0) throw new Error("No public packages found");
  return count;
}

function assertPublishingCheckout(sha, apply) {
  if (process.env.GITHUB_ACTIONS !== "true" || apply !== "--apply") {
    throw new Error("Run only in a disposable GitHub Actions checkout with --apply");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sha !== head || sha !== process.env.GITHUB_SHA)
    throw new Error("Preview SHA does not match checkout");
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
  });
  if (status.trim()) throw new Error("Preview checkout has tracked changes");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = process.argv[2] ?? "";
  const version = previewVersion(sha);
  assertPublishingCheckout(sha, process.argv[3]);
  const count = stampPreviewPackages(join(import.meta.dirname, "..", "packages"), version);
  // oxlint-disable-next-line no-console -- expose the published version in the workflow log
  console.log(`Stamped ${count} packages: ${version}`);
}
