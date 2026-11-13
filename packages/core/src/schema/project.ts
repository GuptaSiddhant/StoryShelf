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
  /** Run axe accessibility checks during capture; on by default (annotations never block). */
  runA11y?: boolean;
  /**
   * Run the Storybook 10 `.test()` entries as interaction tests during capture (ADR 0004,
   * decision 11); off by default because it changes what a build contains.
   */
  runTests?: boolean;
  /** Re-render a changed snapshot once and flag it when the two renders differ; on by default. */
  detectUnstable?: boolean;
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
   * A build claiming the default branch counts as one only once a git channel confirmed the commit
   * is on it (ADR 0009, amendment 2026-11-13); the column defaults to true. Off, a claim no channel
   * can check counts as before and is shown as unverified.
   */
  requireVerifiedDefault?: boolean;
  /**
   * Lifetime in seconds of the signed Storybook URLs of this project's renders (ADR 0007,
   * decision 5); null derives it from the build's stories.
   */
  storybookUrlTtlSeconds?: number | null;
  /** JSON `OwnerRule[]` mapping story-file globs to member user ids (#465); null when none. */
  componentOwners?: string | null;
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
