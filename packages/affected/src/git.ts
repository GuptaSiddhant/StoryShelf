import { execFileSync } from "node:child_process";

/** Upper bound on changed files before falling back to a full render. */
export const MAX_CHANGED_FILES = 10_000;

/** Run a git subcommand, returning trimmed stdout. Throws on failure. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * True when the checkout cannot support diffing (shallow clone, missing git,
 * or not a repository). Callers treat this as "render everything".
 *
 * @param cwd - Repository root to probe.
 */
export function isShallowRepo(cwd: string): boolean {
  try {
    return git(cwd, ["rev-parse", "--is-shallow-repository"]) === "true";
  } catch {
    return true;
  }
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
