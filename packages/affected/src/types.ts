/**
 * Shared types for affected capture: dependency graphs, trace inputs, and
 * the affected-set result. Zero runtime dependencies by design — both the
 * server (`@storyshelf/core`) and the CI client (`storyshelf`) consume this
 * package without inheriting each other's dependency trees.
 */

/** A module dependency graph with edges in both directions. */
export interface DepGraph {
  /** Forward edges: file path → files it directly imports. */
  imports: Record<string, string[]>;
  /** Reverse edges: file path → files that directly import it. */
  importedBy: Record<string, string[]>;
}

/** Options tuning how changed files trace to stories. */
export interface TraceOptions {
  /** Glob patterns (e.g. `**literal*.generated.ts`) excluded from tracing. */
  untraced?: string[];
}

/** Inputs for computing the affected story set of a change. */
export interface AffectedInput {
  /**
   * The Storybook project directory: the repository root, or the package of it that holds
   * `.storybook/` in a monorepo. `buildDir` and the story and module paths are relative to it;
   * the repository root is found from it with `git`.
   */
  cwd: string;
  /** Built Storybook directory holding `index.json` and stats. */
  buildDir: string;
  /** Ancestor commit the current build is compared against. */
  baseSha: string;
  /** Current commit being uploaded. */
  headSha: string;
  /** Glob patterns excluded from tracing. */
  untraced?: string[];
  /** Explicit stats file path (defaults to `<buildDir>/preview-stats.json`). */
  statsFile?: string;
}

/** The affected story set of a change. */
export interface AffectedResult {
  /**
   * Story import paths to render, or `null` when the whole Storybook must be
   * rendered (missing history, global file change, unreadable graph, …).
   */
  affectedImportPaths: string[] | null;
  /** Files changed between `baseSha` and `headSha`, relative to the repository root. */
  changedFiles: string[];
  /** Ancestor commit the diff was computed against. */
  baselineSha: string | null;
  /** Machine-readable reason for a full render (`null` when selective). */
  fullReason: string | null;
}

/** A story-like record carrying the file it was imported from. */
export interface StoryLike {
  importPath?: string | null;
}
