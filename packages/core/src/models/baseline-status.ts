/** Detect when a snapshot's diff was computed against a baseline that has since changed. */
import type { Baseline } from "../schema/baseline.ts";
import type { Snapshot } from "../schema/snapshot.ts";

/** `baselineVersion` recorded when a story had no baseline at diff time. */
export const NO_BASELINE = "none";

/**
 * How a snapshot's recorded baseline compares with the baseline that applies now.
 *
 * - `current`: still the baseline the diff was computed against.
 * - `stale`: the applicable baseline changed (or a baseline now exists for a new story).
 * - `removed`: the baseline the diff used no longer exists.
 * - `unknown`: legacy row without baseline tracking; never blocks review.
 */
export type BaselineStatus = "current" | "stale" | "removed" | "unknown";

type TrackedSnapshot = Pick<Snapshot, "baselineId" | "baselineVersion">;

/**
 * Classify a snapshot against the baseline currently resolved for its story/viewport/branch.
 *
 * @param snapshot - Snapshot with its recorded baseline fields.
 * @param current - Baseline resolved now (own branch, else default branch), or null.
 */
export function baselineStatus(
  snapshot: TrackedSnapshot,
  current: Baseline | null,
): BaselineStatus {
  if (snapshot.baselineVersion === null) {
    return "unknown";
  }
  if (snapshot.baselineId === null) {
    return current === null ? "current" : "stale";
  }
  if (current === null) {
    return "removed";
  }
  const same = current.id === snapshot.baselineId && current.updatedAt === snapshot.baselineVersion;
  return same ? "current" : "stale";
}

/** True when approving should be refused until the diff is recomputed (or forced). */
export function isBaselineDrifted(status: BaselineStatus): boolean {
  return status === "stale" || status === "removed";
}
