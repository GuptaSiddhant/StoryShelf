/** What the project's recent builds say a story costs, so a plan can order its work by it. */
import { BuildModel } from "../../models/build.ts";
import { SnapshotModel } from "../../models/snapshot.ts";
import type { ShardTarget } from "./context.ts";

/**
 * Milliseconds each story cost, taken from the newest build of this project whose snapshots carry
 * timings. Older builds are a fair guide: story render cost moves with the story, not the build.
 *
 * Returns an empty map when nothing has been timed yet — a fresh project, a runner that reports no
 * durations, or a retention purge that took the timed builds with it — and the plan then falls back
 * to slicing by capture count alone.
 */
export async function storyDurations(target: ShardTarget): Promise<Map<string, number>> {
  const { options, project, build } = target;
  const builds = new BuildModel(options.db, options.tables);
  const snapshots = new SnapshotModel(options.db, options.tables);
  // One extra in case the build being planned is among the newest.
  const recent = (await builds.list(project.id, { limit: BUILDS_SCANNED + 1 }))
    .filter((candidate) => candidate.id !== build.id)
    .slice(0, BUILDS_SCANNED);
  for (const candidate of recent) {
    // oxlint-disable-next-line no-await-in-loop -- stops at the first build that carries timings
    const timings = await snapshots.durationsByStory(candidate.id);
    if (timings.size > 0) {
      return timings;
    }
  }
  return new Map();
}

/**
 * Recent builds to look through for timings. More than a couple is wasted work: a build that
 * rendered nothing (everything inherited) carries none, but several in a row do not happen.
 */
const BUILDS_SCANNED = 3;
