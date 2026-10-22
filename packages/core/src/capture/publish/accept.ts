/**
 * The one rule for when publishing accepts a build (ADR 0006, decision 2). Pure: callers read the
 * facts, apply the verdict, and stay free of branching.
 */

/** Facts the verdict depends on. */
export interface PublishFacts {
  /** Whether publishing succeeded. */
  published: boolean;
  /** Whether a capture will run for this build (`testing` is on); capture then owns the status. */
  captureWillRun: boolean;
  /** Whether the build is on the project's default branch. */
  defaultBranch: boolean;
  /** The build's status right now. */
  status: string;
}

/**
 * What publishing does to the build's status.
 *
 * - A capture will run: `unchanged`, the capture sets the status.
 * - Not `pending` any more (already accepted, failed or reviewed): `unchanged`, so a repeated
 *   publish (job redelivery after a lost lease) changes nothing.
 * - Publish failed: `failed`.
 * - Published on the default branch: `approved`.
 * - Published on another branch: `unchanged`, the build waits as `pending` for a verdict. The
 *   review-off auto-accept comes with the per-project review setting.
 */
export function publishVerdict(facts: PublishFacts): "approved" | "failed" | "unchanged" {
  if (facts.captureWillRun || facts.status !== "pending") {
    return "unchanged";
  }
  if (!facts.published) {
    return "failed";
  }
  return facts.defaultBranch ? "approved" : "unchanged";
}
