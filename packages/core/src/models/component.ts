/** Component (story file) roll-ups: status priority, per-build history, and tombstone lookup. */
import type { Build } from "../schema/build.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import type { SnapshotStatus } from "../types.ts";

/** Worst-first order used for status roll-ups. */
const STATUS_PRIORITY: readonly SnapshotStatus[] = [
  "rejected",
  "changed",
  "new",
  "pending",
  "approved",
  "unchanged",
];

/** Statuses that count as "state changed" in a build. */
const CHANGED = new Set<SnapshotStatus>(["changed", "new"]);

/** The most attention-worthy status of a set (unchanged when empty). */
export function worstStatus(statuses: readonly SnapshotStatus[]): SnapshotStatus {
  return STATUS_PRIORITY.find((status) => statuses.includes(status)) ?? "unchanged";
}

/** One build's view of a component. */
export interface ComponentHistoryRow {
  build: Build;
  /** Distinct stories (states) of the file captured in the build. */
  states: number;
  /** Distinct stories that are new or changed in the build. */
  changedStates: number;
  status: SnapshotStatus;
  /** Snapshot the row links to: the first needing attention, else the first. */
  snapshotId: string;
}

/** Per-build history of a component, newest build first; builds without a snapshot of it are skipped. */
export function componentHistory(
  snapshots: readonly Snapshot[],
  builds: readonly Build[],
): ComponentHistoryRow[] {
  const byBuild = Map.groupBy(snapshots, (snapshot) => snapshot.buildId);
  return builds
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((build): ComponentHistoryRow[] => {
      const own = byBuild.get(build.id) ?? [];
      const representative =
        own.find((snap) => snap.status === "changed" || snap.status === "new") ?? own[0];
      if (!representative) return [];
      const changed = own.filter((snap) => CHANGED.has(snap.status));
      return [
        {
          build,
          states: new Set(own.map((snap) => snap.storyId)).size,
          changedStates: new Set(changed.map((snap) => snap.storyId)).size,
          status: worstStatus(own.map((snap) => snap.status)),
          snapshotId: representative.id,
        },
      ];
    });
}

/** Where a component page stands relative to the project's latest build. */
export type ComponentPresence =
  | { kind: "present" }
  | { kind: "moved"; to: string; title: string }
  | { kind: "deleted"; lastSeen: Build }
  | { kind: "unknown" };

/**
 * Classify a component against the latest build. `history` is the component's
 * past builds (newest first); `latest` holds the latest build's snapshots of
 * every file, used to find a moved file by its last-seen title.
 */
export function componentPresence(
  history: readonly ComponentHistoryRow[],
  latestBuildId: string | null,
  latest: readonly Pick<Snapshot, "storyTitle" | "storyImportPath">[],
  lastTitle: string | null,
): ComponentPresence {
  const [newest] = history;
  if (!newest) return { kind: "unknown" };
  if (newest.build.id === latestBuildId) return { kind: "present" };
  const moved = latest.find((snap) => snap.storyTitle === lastTitle && snap.storyImportPath);
  if (moved?.storyImportPath) {
    return { kind: "moved", to: moved.storyImportPath, title: moved.storyTitle };
  }
  return { kind: "deleted", lastSeen: newest.build };
}
