/** A project row. */
export interface Project {
  id: string;
  name: string;
  slug: string;
  gitRepository: string | null;
  gitDefaultBranch: string;
  pixelThreshold: number;
  maxDiffRatio: number;
  publicBranchRegex: string | null;
  storybookMeta: string | null | undefined;
  executePlay: boolean;
  playTimeoutMs: number;
  runA11y?: boolean;
  browser?: string;
  viewports?: string | null;
  /** JSON list of browsers to capture (null: legacy single `browser`). */
  browsers?: string | null;
  /** JSON list of mode names to capture (null: all declared modes). */
  modesAllowlist?: string | null;
  automigrate?: boolean;
  /** AI profile gate: null = AI off for this project; otherwise a profile name. */
  aiProfile?: string | null;
  /** Review is on for this project (ADR 0013, decision 1); the column defaults to true. */
  reviewEnabled?: boolean;
  /** Approvals a build needs when `testing` is off (ADR 0013, decision 3); default 1. */
  reviewApprovals?: number;
  /**
   * Lifetime in seconds of the signed Storybook URLs of this project's renders (ADR 0007,
   * decision 5); null derives it from the build's stories.
   */
  storybookUrlTtlSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Storybook metadata synced from a project's published Storybook. */
export interface StorybookMeta {
  framework?: { name?: string; options?: unknown };
  addons?: string[];
  storiesGlobs?: string[];
  staticDirs?: string[];
  packagePath?: string;
  previewParameters?: Record<string, unknown>;
}
