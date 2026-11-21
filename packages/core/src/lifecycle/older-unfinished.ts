import { CANCELLABLE_BUILD_STATUSES, type BuildStatus } from "./build-lifecycle.ts";

/** The fields of a build that decide which unfinished builds are "older". */
export interface UnfinishedCandidate {
  id: string;
  gitBranch: string;
  createdAt: string;
  status: BuildStatus;
}

/**
 * The builds "cancel older unfinished builds" cancels: of the cancellable (unfinished) builds, all
 * but the `keepNewest` newest of each branch. Newest first by `createdAt`, ties broken by id, so
 * the builds kept are stable. The page's button and the API route both select with this.
 */
export function selectOlderUnfinished<T extends UnfinishedCandidate>(
  builds: readonly T[],
  keepNewest: number,
): T[] {
  const seen = new Map<string, number>();
  return builds
    .filter((build) => CANCELLABLE_BUILD_STATUSES.includes(build.status))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .filter((build) => {
      const rank = seen.get(build.gitBranch) ?? 0;
      seen.set(build.gitBranch, rank + 1);
      return rank >= keepNewest;
    });
}
