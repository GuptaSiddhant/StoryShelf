/** Shared (story, mode) review: one decision covers every browser's snapshot. */
import { SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";
import { baselineChanged, findDriftedSnapshots, isOpenSnapshot } from "./baseline-guard.ts";
import { approveSnapshot, refreshBuild } from "./builds.handlers.ts";
import { notFound } from "./helpers.ts";

/** Identity of a review group: the same story and mode across engines. */
export function groupKey(snapshot: Pick<Snapshot, "storyId" | "viewportName">): string {
  return `${snapshot.storyId}\u0000${snapshot.viewportName}`;
}

/** Open snapshots of one story/mode; 404 when the group has nothing left to decide. */
async function openMembers(build: Build, storyId: string, modeKey: string): Promise<Snapshot[]> {
  const all = await new SnapshotModel(getStore().db).listByBuild(build.id);
  const members = all.filter(
    (snapshot) =>
      snapshot.storyId === storyId && snapshot.viewportName === modeKey && isOpenSnapshot(snapshot),
  );
  if (members.length === 0) {
    notFound("No open snapshots for this story and mode");
  }
  return members;
}

/**
 * Approve every open snapshot of a story/mode, promoting each engine's
 * baseline. All-or-nothing on drift: when any member's baseline moved and
 * `force` is off, nothing is written and the 409 names that snapshot.
 *
 * @returns The approved snapshot ids, primary engine first.
 */
export async function approveGroup(
  project: Project,
  build: Build,
  target: { storyId: string; modeKey: string },
  userId: string | null,
  options: { force?: boolean } = {},
): Promise<string[]> {
  const members = await openMembers(build, target.storyId, target.modeKey);
  if (!options.force) {
    const drifted = await findDriftedSnapshots(project, build, members);
    const first = [...drifted.entries()][0];
    if (first) {
      throw baselineChanged(first[0], first[1]);
    }
  }
  for (const member of members) {
    // oxlint-disable-next-line no-await-in-loop -- baselines are promoted engine by engine
    await approveSnapshot(member.id, userId, { force: options.force ?? false });
  }
  return members.map((member) => member.id);
}

/** Reject every open snapshot of a story/mode and refresh the build once. */
export async function rejectGroup(
  build: Build,
  target: { storyId: string; modeKey: string },
  userId: string | null,
): Promise<string[]> {
  const members = await openMembers(build, target.storyId, target.modeKey);
  const snapshots = new SnapshotModel(getStore().db);
  await Promise.all(
    members.map(async (member) => await snapshots.review(member.id, "rejected", userId)),
  );
  await refreshBuild(build.id);
  return members.map((member) => member.id);
}

/**
 * Split open snapshots into approvable groups and groups skipped because some
 * member drifted (the whole group is skipped, never half-approved).
 */
export function splitByDrift(
  open: Snapshot[],
  drifted: ReadonlyMap<string, unknown>,
): { approvable: Snapshot[]; skipped: Snapshot[] } {
  const blocked = new Set(open.filter((s) => drifted.has(s.id)).map((s) => groupKey(s)));
  return {
    approvable: open.filter((s) => !blocked.has(groupKey(s))),
    skipped: open.filter((s) => blocked.has(groupKey(s))),
  };
}
