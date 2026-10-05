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
  /** Affected capture enabled for this build (default true). */
  affectedOnly: boolean;
  /** Ancestor commit the affected set was computed against, if any. */
  baselineSha: string | null;
  /** JSON array of repo-relative changed files, if computed. */
  changedFiles: string | null;
  /** JSON array of affected story import paths; null means full capture. */
  affectedImportPaths: string | null;
  createdAt: string;
  updatedAt: string;
}
