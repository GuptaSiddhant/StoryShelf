/** Status of a git provider check. */
export type CheckStatus = "pending" | "success" | "failure";

/** Reports build status to a git provider (e.g. GitHub status checks). */
export interface StatusAdapter {
  /** Set the status of a git provider check for a commit. */
  setStatus(context: string, gitSha: string, status: CheckStatus, url: string): Promise<void>;
}
