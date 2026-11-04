import type { DatabaseAdapter } from "../adapters/database.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import { SnapshotModel, type SnapshotTables } from "../models/snapshot.ts";
import { baselineNote, isA11yNote } from "./a11y/index.ts";

/** The sha shown when the baseline's build row is gone (builds are transient). */
const UNKNOWN_SHA = "unknown";

/**
 * The a11y list for a snapshot inherited from a baseline: the findings measured on the baseline's
 * source snapshot, behind a `from baseline <sha>` note so no reader presents them as measured on this
 * build. Null when the source recorded no findings (or cannot be found). Notes of the source run
 * (`axe unavailable` and the like) are not carried: they describe a run that is not this build's.
 */
export async function inheritedA11yJson(
  db: DatabaseAdapter,
  tables: SnapshotTables & BuildTables,
  source: { snapshotId: string | null; buildId: string | null | undefined },
): Promise<string | null> {
  if (!source.snapshotId) return null;
  const stored = (await new SnapshotModel(db, tables).get(source.snapshotId))?.a11yViolations;
  const findings = parseList(stored).filter((text) => !isA11yNote(text));
  if (findings.length === 0) return null;
  const build = source.buildId ? await new BuildModel(db, tables).get(source.buildId) : null;
  return JSON.stringify([baselineNote(build?.gitSha ?? UNKNOWN_SHA), ...findings]);
}

function parseList(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}
