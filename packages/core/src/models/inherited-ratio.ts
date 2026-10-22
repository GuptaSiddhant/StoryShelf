/**
 * Affected-capture efficiency of a project (#140): how much of its recent builds was inherited from
 * the baseline instead of rendered. Pure and computed from the counts stored on the builds
 * (`snapshotCount`, `inheritedCount`), so a page needs no per-snapshot query.
 */
import type { Build } from "../schema/build.ts";

/** Builds the average looks at by default (newest first). */
export const RECENT_BUILDS_FOR_INHERITED_RATIO = 20;

/** The average inherited ratio of a project's recent builds. */
export interface InheritedRatio {
  /** Mean of each build's `inheritedCount / snapshotCount`, from 0 to 1. */
  ratio: number;
  /** Builds that went into the mean. */
  builds: number;
}

/**
 * The mean inherited ratio over the newest `limit` builds that hold snapshots, or `null` when none
 * does (no data is not a 0 % skip rate). A build with no snapshots has no ratio and is skipped.
 */
export function averageInheritedRatio(
  builds: readonly Pick<Build, "createdAt" | "snapshotCount" | "inheritedCount">[],
  limit: number = RECENT_BUILDS_FOR_INHERITED_RATIO,
): InheritedRatio | null {
  const recent = builds
    .filter((build) => build.snapshotCount > 0)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  if (recent.length === 0) {
    return null;
  }
  const sum = recent.reduce(
    (total, build) => total + Math.min(1, build.inheritedCount / build.snapshotCount),
    0,
  );
  return { ratio: sum / recent.length, builds: recent.length };
}
