import type { Build, Project, Snapshot } from "@storyshelf/core/schema";

/** How far a build's review has progressed, counted per story/mode (not per browser). */
export interface ReviewProgress {
  /** Groups a human has to decide on (any open or decided member). */
  reviewable: number;
  /** Reviewable groups with no open member left. */
  done: number;
  /** Groups still waiting for a decision. */
  pending: number;
}

const OPEN = new Set(["new", "changed"]);
const DECIDED = new Set(["approved", "rejected"]);

/**
 * One story in one mode, with its snapshot on every engine. Approval is shared:
 * a single decision covers all members.
 */
export interface SnapshotGroup {
  /** Stable identity (story + mode). */
  key: string;
  storyId: string;
  /** The mode key (`viewportName`). */
  modeKey: string;
  /** Member snapshots, chromium first, then by engine name. */
  members: Snapshot[];
  /** The primary engine's snapshot (chromium when present). */
  primary: Snapshot;
  /** Snapshot the filmstrip links to: first open member, else the first member. */
  representative: Snapshot;
}

const browserOf = (snap: Pick<Snapshot, "browser">): string => snap.browser ?? "chromium";

function memberOrder(a: Snapshot, b: Snapshot): number {
  const left = browserOf(a);
  const right = browserOf(b);
  if (left === right) return 0;
  if (left === "chromium") return -1;
  if (right === "chromium") return 1;
  return left < right ? -1 : 1;
}

/** Group snapshots by story and mode, keeping first-appearance order. */
export function groupSnapshots(snapshots: Snapshot[]): SnapshotGroup[] {
  const groups = new Map<string, Snapshot[]>();
  for (const snap of snapshots) {
    const key = `${snap.storyId}\u0000${snap.viewportName}`;
    groups.set(key, [...(groups.get(key) ?? []), snap]);
  }
  return [...groups.entries()].flatMap(([key, list]): SnapshotGroup[] => {
    const members = list.toSorted(memberOrder);
    const [primary] = members;
    if (!primary) return [];
    return [
      {
        key,
        storyId: primary.storyId,
        modeKey: primary.viewportName,
        members,
        primary,
        representative: members.find((snap) => OPEN.has(snap.status)) ?? primary,
      },
    ];
  });
}

/** Whether a group still has a snapshot waiting for a decision. */
export function isOpenGroup(group: SnapshotGroup): boolean {
  return group.members.some((snap) => OPEN.has(snap.status));
}

/** Count review progress per group; groups of unchanged snapshots need no decision. */
export function reviewProgress(snapshots: Snapshot[]): ReviewProgress {
  const groups = groupSnapshots(snapshots);
  const pending = groups.filter((group) => isOpenGroup(group)).length;
  const done = groups.filter(
    (group) => !isOpenGroup(group) && group.members.some((snap) => DECIDED.has(snap.status)),
  ).length;
  return { reviewable: pending + done, done, pending };
}

/** Position of the selected group plus its neighbours in list order. */
export interface Neighbours {
  /** 1-based group position, or 0 when nothing is selected. */
  position: number;
  /** Number of groups. */
  total: number;
  prev: Snapshot | null;
  next: Snapshot | null;
}

/** Previous/next group (as its representative snapshot) around the selected snapshot. */
export function neighbours(snapshots: Snapshot[], selectedId?: string): Neighbours {
  const groups = groupSnapshots(snapshots);
  const index = groups.findIndex((group) => group.members.some((snap) => snap.id === selectedId));
  if (index === -1) {
    return { position: 0, total: groups.length, prev: null, next: null };
  }
  return {
    position: index + 1,
    total: groups.length,
    prev: groups[index - 1]?.representative ?? null,
    next: groups[index + 1]?.representative ?? null,
  };
}

/** The group a snapshot belongs to. */
export function groupOf(snapshots: Snapshot[], snapshotId: string): SnapshotGroup | undefined {
  return groupSnapshots(snapshots).find((group) =>
    group.members.some((snap) => snap.id === snapshotId),
  );
}

/** Diff size as a percentage string ("3.1%"), or null when not computed. */
export function diffPercent(snapshot: Pick<Snapshot, "diffRatio">): string | null {
  return snapshot.diffRatio === null || snapshot.diffRatio === undefined
    ? null
    : `${(snapshot.diffRatio * 100).toFixed(1)}%`;
}

/** Review-page URL for one snapshot. */
export function snapshotPageUrl(project: Project, build: Build, snapshotId: string): string {
  return `/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snapshotId}`;
}

/** API URL of a snapshot image (`image`), its diff overlay, or its baseline. */
export function snapshotImageUrl(
  project: Project,
  build: Build,
  snapshot: Snapshot,
  kind: "image" | "diff" | "baseline",
): string {
  return `/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snapshot.id}/${kind}`;
}

/** Mode and engine of a snapshot for labels: `dark`, `dark · firefox` (chromium is implicit). */
export function snapshotVariant(snap: Pick<Snapshot, "viewportName" | "browser">): string {
  const browser = snap.browser ?? "chromium";
  return browser === "chromium" ? snap.viewportName : `${snap.viewportName} · ${browser}`;
}
