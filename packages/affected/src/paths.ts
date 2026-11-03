/**
 * Absolute-path keys for matching changed files against Storybook modules.
 *
 * `git` reports changed files relative to the repository root, while the bundler's module ids and
 * the story index are relative to the Storybook project, which is a subdirectory in a monorepo
 * package. Comparing those strings (or suffixes of them) misses every change, so both sides are
 * resolved to absolute paths before they meet (#502).
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** The two directories relative paths are resolved against. */
export interface PathBase {
  /** Absolute repository root (`git rev-parse --show-toplevel`), with `/` separators. */
  repoRoot: string;
  /** Absolute Storybook project root (the directory the build runs in), with `/` separators. */
  projectRoot: string;
  /** Compare paths ignoring case (Windows). */
  caseInsensitive: boolean;
}

const posix = (path: string): string => path.replaceAll("\\", "/");

const fold = (base: PathBase, path: string): string =>
  base.caseInsensitive ? path.toLowerCase() : path;

/** A bundler id that names no file: a virtual module, a URL or a NUL-prefixed internal id. */
function namesNoFile(path: string): boolean {
  return (
    path.includes("\0") ||
    path.startsWith("/@") ||
    path.startsWith("__x00__") ||
    /^[a-z][a-z0-9+.-]+:/iu.test(path)
  );
}

/** Whether `inside` (a path relative to some root) stays within that root. */
function staysInside(inside: string): boolean {
  return inside.split(/[\\/]/u)[0] !== ".." && !isAbsolute(inside);
}

/**
 * The bases to resolve against, or `null` when they cannot be determined: no repository root, a
 * `cwd` that does not exist, or a project outside the repository.
 *
 * @param repoRoot - The repository root git reported, or `null`.
 * @param cwd - The Storybook project directory.
 * @param platform - Defaults to the running platform; decides case sensitivity.
 */
export function pathBase(
  repoRoot: string | null,
  cwd: string,
  platform: string = process.platform,
): PathBase | null {
  if (repoRoot === null) return null;
  let projectRoot: string;
  try {
    projectRoot = realpathSync(resolve(cwd));
  } catch {
    return null;
  }
  const root = resolve(repoRoot);
  return staysInside(relative(root, projectRoot))
    ? {
        repoRoot: posix(root),
        projectRoot: posix(projectRoot),
        caseInsensitive: platform === "win32",
      }
    : null;
}

/** The key of a changed file, given as git reports it: relative to the repository root. */
export function keyOfChangedFile(base: PathBase, file: string): string {
  return fold(base, posix(resolve(base.repoRoot, file)));
}

/** The key of a story's `importPath`, which is relative to the Storybook project. */
export function keyOfStoryFile(base: PathBase, importPath: string): string {
  return fold(base, posix(resolve(base.projectRoot, importPath)));
}

/** Whether `absolute` is a path inside the repository. */
function insideRepo(base: PathBase, absolute: string): boolean {
  return fold(base, absolute).startsWith(`${fold(base, base.repoRoot)}/`);
}

/**
 * The key of a bundler module id (already stripped of loaders and queries), or `null` when the id
 * names no file. Ids are project-relative (`./src/a.ts`, `../core/src/b.ts`); an absolute id inside
 * the repository is kept, and a leading-slash id outside it is the bundler's project-root form
 * (`/src/a.ts`).
 */
export function keyOfModuleId(base: PathBase, id: string): string | null {
  // Vite's `/@fs/<absolute path>` is a real file; the other `/@…` ids are virtual.
  const path = posix(id).replace(/^\/@fs\//u, "/");
  if (!posix(id).startsWith("/@fs/") && namesNoFile(path)) return null;
  if (isAbsolute(path) && insideRepo(base, posix(resolve(path)))) {
    return fold(base, posix(resolve(path)));
  }
  const rooted = path.startsWith("/") && !/^\/[a-z]:\//iu.test(path);
  return fold(base, posix(resolve(base.projectRoot, rooted ? path.slice(1) : path)));
}

/** A path relative to the Storybook project, for the globs users write next to `.storybook/`. */
export function projectRelative(base: PathBase, repoRelativeFile: string): string {
  return posix(relative(base.projectRoot, resolve(base.repoRoot, repoRelativeFile)));
}
