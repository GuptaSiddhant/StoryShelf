import type { BuildStatus } from "../types.ts";

/** A build row. */
export interface Build {
  id: string;
  projectId: string;
  gitSha: string;
  gitBranch: string;
  isDefault: boolean;
  authorEmail: string | null;
  authorName: string | null;
  message: string | null;
  public: boolean;
  status: BuildStatus;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
  /** Snapshots inherited from the baseline without rendering (affected capture); a subset of `snapshotCount`. */
  inheritedCount: number;
  /** Affected capture enabled for this build (default true). */
  affectedOnly: boolean;
  /** Ancestor commit the affected set was computed against, if any. */
  baselineSha: string | null;
  /** JSON array of repo-relative changed files, if computed. */
  changedFiles: string | null;
  /** JSON array of affected story import paths; null means full capture. */
  affectedImportPaths: string | null;
  /**
   * JSON array of the results of the build's Storybook `.test()` entries (`TestResult`); null when
   * the project does not run tests or the Storybook has none.
   */
  testResults?: string | null;
  /** Times the build went back to `pending` from a verdict; each starts a new review cycle (ADR 0013). */
  reviewCycle?: number;
  /** The review cycle whose `review:requested` was already announced; null until the first. */
  reviewRequestedCycle?: number | null;
  /**
   * The capture job whose run owns this build, stamped when the build is enqueued and cleared on
   * reset. A late crash hook compares it with its own job id, so it never fails a newer run. Null
   * means no run owns the build.
   */
  captureJobId?: string | null;
  /**
   * Orders the writers of {@link Build.captureJobId}: a retry reset advances it, and an enqueue
   * stamps its job only while the generation it read is still current, so a stale enqueue never
   * overwrites a newer run's ownership. Starts at 0.
   */
  captureGeneration?: number;
  /**
   * Hash of the manifest the file-by-file upload accepted (write-once publish, ADR 0051). Null
   * until a manifest claims it, and again after a failed publish releases it.
   */
  manifestSha256?: string | null;
  /**
   * The newer build that cancelled this one as superseded (ADR 0045). Set in the write that cancels;
   * the build stays `cancelled`. Null for any other build.
   */
  supersededByBuildId?: string | null;
  createdAt: string;
  updatedAt: string;
}
