import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

/** Upper bound on changed files before falling back to a full render. */
export const MAX_CHANGED_FILES = 10_000;

/** Prefix marking CLI-synthesized identities for checkouts without git. */
export const LOCAL_SHA_PREFIX = "local-";

/** Default branch for synthesized identities (isolates local experiments). */
export const LOCAL_BRANCH = "local";

/**
 * A git subcommand that failed. `message` is git's first stderr line, never the multi-line dump
 * `execFileSync` builds. `unknownRevision` marks a revision the checkout does not hold (an unknown
 * name, or a commit a shallow clone never fetched).
 */
export class GitCommandError extends Error {
  readonly unknownRevision: boolean;

  constructor(message: string, unknownRevision: boolean) {
    super(message);
    this.name = "GitCommandError";
    this.unknownRevision = unknownRevision;
  }
}

/** git's wording for a revision it cannot resolve: "unknown revision" or, in a shallow clone, "Invalid revision range". */
const UNKNOWN_REVISION = /unknown revision|Invalid revision range/u;

/** The first non-empty line of a text, or `""`. */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

/** Map an `execFileSync` failure to a `GitCommandError` carrying git's own first line. */
function gitFailure(error: unknown): GitCommandError {
  const failure = error as { stderr?: unknown; message?: unknown };
  const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
  const message = typeof failure.message === "string" ? failure.message : "git failed";
  const line = firstLine(stderr) || firstLine(message);
  return new GitCommandError(line, UNKNOWN_REVISION.test(stderr));
}

/**
 * Run a git subcommand, returning trimmed stdout. Throws a `GitCommandError` on failure.
 * `LC_ALL=C` keeps git's messages in English, so `UNKNOWN_REVISION` matches on any machine.
 */
function git(cwd: string, args: string[]): string {
  // stderr is piped, never inherited: outside a checkout git's `fatal:` lines must not reach the terminal.
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
  } catch (error) {
    throw gitFailure(error);
  }
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
 * Every path is relative to the repository root, whichever directory `cwd`
 * is: git reports untracked files relative to the directory it runs in, and
 * only below it, so the whole listing runs at the root.
 *
 * @param cwd - A directory inside the repository (its root, or a package of it).
 * @param base - Ancestor commit (baseline).
 * @param head - Current commit.
 */
export function changedFiles(cwd: string, base: string, head: string): string[] {
  const root = gitRepoRoot(cwd) ?? cwd;
  const files = new Set([...committedChanges(root, base, head), ...workingTreeChanges(root)]);
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
 * The repository root containing `cwd` (`git rev-parse --show-toplevel`), or `null` when git is
 * missing or `cwd` is not inside a repository.
 */
export function gitRepoRoot(cwd: string): string | null {
  return tryGit(cwd, ["rev-parse", "--show-toplevel"]);
}

/**
 * Whether the checkout holds this commit. A shallow clone lacks the commits it never fetched, and
 * a name starting with `-` is never a commit.
 */
export function hasCommit(cwd: string, sha: string): boolean {
  if (sha.startsWith("-")) {
    return false;
  }
  try {
    git(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
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
