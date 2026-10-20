/** Mark-and-sweep for a project's content-addressed screenshots. */
import { and, eq, gte, inArray, like } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { Logger } from "pino";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { col } from "../models/columns.ts";
import { contentDir } from "../utils/paths.ts";
import { CLAIMS_DIR } from "../utils/screenshot-store.ts";

/** Longest an unreferenced screenshot is kept after the sweep first sees it (default 24 h). */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/** Marker object remembering when each unreferenced screenshot was first seen. */
const MARKER = ".sweep.json";

/**
 * Build statuses during which a capture may have reused an existing object (the "already exists,
 * skip the write" path) without yet writing the snapshot rows that reference it.
 */
const ACTIVE_BUILD_STATUSES = ["pending", "capturing", "comparing"];

/** Tables the sweep reads references and in-flight builds from. */
export interface SweepTables {
  snapshots: Table;
  baselines: Table;
  builds: Table;
}

/** Inputs for {@link sweepScreenshotContent}. */
export interface SweepDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  tables: SweepTables;
  logger?: Logger;
}

/** What one sweep did. */
export interface SweepResult {
  /** Objects deleted. */
  removed: number;
  /** Unreferenced objects still inside their grace period. */
  pending: number;
}

/**
 * Delete content-addressed screenshots that no snapshot or baseline points at any more.
 *
 * An object is deleted only after it has been unreferenced across two sweeps at least `graceMs`
 * apart (first-seen times live in a marker object, so no schema is needed and the storage
 * adapter needs no modification times). A capture writes its screenshot before the rows that
 * reference it, so a single look is never enough; each candidate is also re-checked against the
 * database immediately before it is deleted.
 *
 * Reusing an object that already exists writes nothing, so the sweep cannot see it by looking at
 * storage. Deletion is therefore deferred (objects stay pending, first-seen times kept) while the
 * project has reuse in flight: a build still capturing, or a reuse claim from a baseline import or
 * approval ({@link withContentClaim}). Both checks are bounded by the grace period, so a build
 * stuck in `capturing` or a claim left by a crash delays reclaiming storage, never forever.
 */
export async function sweepScreenshotContent(
  deps: SweepDeps,
  projectId: string,
  options: { now?: number; graceMs?: number } = {},
): Promise<SweepResult> {
  const dir = `${contentDir(projectId)}/`;
  const unreferenced = await findUnreferenced(deps, projectId, dir);
  const firstSeen = await readMarker(deps.storage, dir);
  const outcome = await deleteDue(deps, projectId, unreferenced, firstSeen, {
    now: options.now ?? Date.now(),
    graceMs: options.graceMs ?? SWEEP_GRACE_MS,
  });
  await writeMarker(deps.storage, dir, outcome.pending, firstSeen);
  if (outcome.removed > 0) {
    deps.logger?.info({ projectId, removed: outcome.removed }, "removed unreferenced screenshots");
  }
  return { removed: outcome.removed, pending: Object.keys(outcome.pending).length };
}

async function findUnreferenced(
  deps: SweepDeps,
  projectId: string,
  dir: string,
): Promise<string[]> {
  // Only this project's content screenshots: the prefix guards against an adapter listing keys
  // in another form (such as OS-separated paths), which would otherwise match no reference.
  const objects = (await deps.storage.list(dir)).filter(
    (path) => path.startsWith(dir) && path.endsWith(".png"),
  );
  const referenced = await referencedPaths(deps, projectId);
  return objects.filter((path) => !referenced.has(path));
}

/** Delete what has been unreferenced for the whole grace period; return the rest with first-seen times. */
async function deleteDue(
  deps: SweepDeps,
  projectId: string,
  unreferenced: string[],
  firstSeen: Record<string, number>,
  clock: { now: number; graceMs: number },
): Promise<{ removed: number; pending: Record<string, number> }> {
  const pending: Record<string, number> = {};
  let removed = 0;
  for (const path of unreferenced) {
    const seen = firstSeen[path] ?? clock.now;
    // oxlint-disable-next-line eslint/no-await-in-loop -- re-check and delete one object at a time
    if (clock.now - seen >= clock.graceMs && !(await isHeld(deps, projectId, path, clock))) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      await deps.storage.delete(path);
      removed += 1;
    } else {
      pending[path] = seen;
    }
  }
  return { removed, pending };
}

async function referencedPaths(deps: SweepDeps, projectId: string): Promise<Set<string>> {
  const rows = await Promise.all(
    [deps.tables.snapshots, deps.tables.baselines].map(
      async (table) =>
        (await deps.db.list(table, {
          where: and(
            eq(col(table, "projectId"), projectId),
            like(col(table, "screenshotPath"), `${contentDir(projectId)}/%`),
          ),
        })) as unknown as { screenshotPath: string }[],
    ),
  );
  return new Set(rows.flat().map((row) => row.screenshotPath));
}

/** Whether `path` must be kept now: referenced by a row, or reuse may be in flight. */
async function isHeld(
  deps: SweepDeps,
  projectId: string,
  path: string,
  clock: { now: number; graceMs: number },
): Promise<boolean> {
  return (
    (await isReferenced(deps, projectId, path)) ||
    (await hasActiveBuild(deps, projectId, clock)) ||
    (await hasActiveClaim(deps.storage, projectId, clock))
  );
}

/** A build of the project that is still capturing and was updated within the grace period. */
async function hasActiveBuild(
  deps: SweepDeps,
  projectId: string,
  clock: { now: number; graceMs: number },
): Promise<boolean> {
  const table = deps.tables.builds;
  const rows = await deps.db.list(table, {
    where: and(
      eq(col(table, "projectId"), projectId),
      inArray(col(table, "status"), ACTIVE_BUILD_STATUSES),
      gte(col(table, "updatedAt"), new Date(clock.now - clock.graceMs).toISOString()),
    ),
    limit: 1,
  });
  return rows.length > 0;
}

/** A reuse claim younger than the grace period; older ones (left by a crash) are ignored. */
async function hasActiveClaim(
  storage: StorageAdapter,
  projectId: string,
  clock: { now: number; graceMs: number },
): Promise<boolean> {
  const claims = await storage.list(`${contentDir(projectId)}/${CLAIMS_DIR}/`);
  const times = await Promise.all(claims.map(async (path) => await claimTime(storage, path)));
  return times.some((at) => at === null || clock.now - at < clock.graceMs);
}

/** When a claim was made; null when it cannot be read (treated as active: fail safe). */
async function claimTime(storage: StorageAdapter, path: string): Promise<number | null> {
  try {
    const parsed = JSON.parse((await storage.read(path)).toString("utf8")) as { at?: unknown };
    return typeof parsed.at === "number" ? parsed.at : null;
  } catch {
    return null;
  }
}

async function isReferenced(deps: SweepDeps, projectId: string, path: string): Promise<boolean> {
  const hits = await Promise.all(
    [deps.tables.snapshots, deps.tables.baselines].map(
      async (table) =>
        (
          await deps.db.list(table, {
            where: and(
              eq(col(table, "projectId"), projectId),
              eq(col(table, "screenshotPath"), path),
            ),
            limit: 1,
          })
        ).length > 0,
    ),
  );
  return hits.some(Boolean);
}

async function readMarker(storage: StorageAdapter, dir: string): Promise<Record<string, number>> {
  try {
    if (!(await storage.exists(`${dir}${MARKER}`))) {
      return {};
    }
    const parsed = JSON.parse((await storage.read(`${dir}${MARKER}`)).toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function writeMarker(
  storage: StorageAdapter,
  dir: string,
  next: Record<string, number>,
  previous: Record<string, number>,
): Promise<void> {
  if (JSON.stringify(next) !== JSON.stringify(previous)) {
    await storage.write(`${dir}${MARKER}`, Buffer.from(JSON.stringify(next)));
  }
}
