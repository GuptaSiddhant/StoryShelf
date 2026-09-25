import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

/** Upper bound on changed files before falling back to a full render. */
export const MAX_CHANGED_FILES = 10_000;

/** Prefix marking CLI-synthesized identities for checkouts without git. */
export const LOCAL_SHA_PREFIX = "local-";

/** Default branch for synthesized identities (isolates local experiments). */
export const LOCAL_BRANCH = "local";

/** Run a git subcommand, returning trimmed stdout. Throws on failure. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Repository git status relevant to affected capture. */
export type GitRepoStatus = "ok" | "shallow" | "no-git";
/**
 * Probe whether the checkout can support diffing: a full repo (`ok`), a
 * shallow clone (`shallow`), or missing git / not a repository (`no-git`).
 */
export function gitRepoStatus(cwd: string): GitRepoStatus {
  let shallow: string | null;
  try {
    shallow = git(cwd, ["rev-parse", "--is-shallow-repository"]);
  } catch {
    return "no-git";
  }
  return shallow === "true" ? "shallow" : "ok";
}

/**
 * True when the checkout cannot support diffing (shallow clone, missing git,
 * or not a repository). Callers treat this as "render everything".
 *
 * @param cwd - Repository root to probe.
 */
export function isShallowRepo(cwd: string): boolean {
  return gitRepoStatus(cwd) !== "ok";
}

/** Split `git --name-only` output into a deduplicated file list. */
function parseNameOnly(output: string): string[] {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      files.add(trimmed);
    }
  }
  return [...files];
}

/** Committed changes between two revisions (two-dot range). */
function committedChanges(cwd: string, base: string, head: string): string[] {
  return parseNameOnly(git(cwd, ["diff", "--name-only", `${base}..${head}`]));
}

/** Staged and unstaged changes plus untracked files (never committed). */
function workingTreeChanges(cwd: string): string[] {
  const againstHead = parseNameOnly(git(cwd, ["diff", "--name-only", "HEAD"]));
  const untracked = parseNameOnly(git(cwd, ["ls-files", "--others", "--exclude-standard"]));
  return [...new Set([...againstHead, ...untracked])];
}

/**
 * Repo-relative files changed between `base` and `head`, including staged
 * and untracked working-tree files. Throws when git cannot diff.
 *
 * @param cwd - Repository root.
 * @param base - Ancestor commit (baseline).
 * @param head - Current commit.
 */
export function changedFiles(cwd: string, base: string, head: string): string[] {
  const files = new Set([...committedChanges(cwd, base, head), ...workingTreeChanges(cwd)]);
  return [...files].toSorted();
}

/** Run a git subcommand, returning trimmed stdout or `null` on any failure. */
function tryGit(cwd: string, args: string[]): string | null {
  try {
    const output = git(cwd, args);
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Current commit of the checkout, or `null` when git is missing, `cwd` is
 * not a repository, or HEAD is unborn.
 */
export function gitHeadSha(cwd: string): string | null {
  return tryGit(cwd, ["rev-parse", "HEAD"]);
}

/**
 * Current branch of the checkout, or `null` when detached, unborn, or git
 * is unavailable.
 */
export function gitBranchName(cwd: string): string | null {
  const branch = tryGit(cwd, ["branch", "--show-current"]);
  if (branch) {
    return branch;
  }
  const abbrev = tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return abbrev && abbrev !== "HEAD" ? abbrev : null;
}

/** Synthesize a unique local sha for checkouts without git. */
export function localSha(): string {
  return `${LOCAL_SHA_PREFIX}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
