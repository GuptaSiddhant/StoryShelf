/** Shapes the pull-request comment builder reads; plain data, resolved by the caller. */

/** One changed or new story in the table. */
export interface CommentChange {
  /** `Title / Name`. */
  story: string;
  /** Browser and viewport, e.g. `chromium, desktop`. */
  target: string;
  /** `2.4 %` for a changed snapshot, `new` for one without a baseline. */
  change: string;
  /** The snapshot's review page. */
  reviewUrl: string;
  /** The story in the published Storybook (`index.html?path=…`); absent while unpublished. */
  storyUrl?: string | undefined;
}

/** An earlier build of the same pull request, one line in the history. */
export interface CommentEarlierBuild {
  /** Short state text, e.g. `✅ approved`. */
  state: string;
  sha: string;
  url: string;
}

/** Inputs of {@link buildCommentMarkdown}; every field is data, so the builder reads nothing else. */
export interface BuildCommentInput {
  /** `testing` is on: capture, compare and the snapshot rollup decide. Off: the review gate does. */
  testing: boolean;
  /** Build status: `pending`, `capturing`, `comparing`, `reviewing`, `approved`, `rejected`, `failed`, `cancelled`. */
  status: string;
  /** Short commit of the build. */
  sha: string;
  /** Review page: the diff page with testing on, the build page without. */
  reviewUrl: string;
  /** The build page; shown beside the review link only when it is another page. */
  buildUrl: string;
  /** Full Storybook UI (`index.html`), present once the Storybook is published. */
  storybookUrl?: string | undefined;
  /** Log section and retry control of the build page, linked from a failed capture. */
  logUrl?: string | undefined;
  retryUrl?: string | undefined;
  counts: {
    snapshotCount: number;
    changedCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
  changes?: readonly CommentChange[] | undefined;
  /** Titles of stories the baseline had and this build lacks. */
  removed?: readonly string[] | undefined;
  /** Names of failing Storybook tests; they block the merge. */
  failedTests?: readonly string[] | undefined;
  /** Accessibility findings, a count only: they never change the headline. */
  a11yCount?: number | undefined;
  /** Who gave the verdict; shown for an approved or rejected build. */
  reviewer?: string | undefined;
  /** Short reason of a failed capture. */
  failure?: string | undefined;
  /** Approval progress, shown while the review waits. */
  approvals?: { given: number; required: number } | undefined;
  /** Stories rendered of the total, when the capture was partial. */
  capture?: { rendered: number; total: number } | undefined;
  /** ISO time of the last update; the builder reads no clock. */
  updatedAt?: string | undefined;
  earlier?: readonly CommentEarlierBuild[] | undefined;
  /** A newer build cancelled this one (ADR 0045). */
  supersededBy?: { url: string; sha: string } | undefined;
}
