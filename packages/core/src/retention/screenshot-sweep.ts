/** Mark-and-sweep for a project's content-addressed screenshots. */
import { and, eq, getTableColumns, like } from "drizzle-orm";
import type { Column, Table } from "drizzle-orm";
import type { Logger } from "pino";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { contentDir } from "../utils/paths.ts";

/** Longest an unreferenced screenshot is kept after the sweep first sees it (default 24 h). */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/** Marker object remembering when each unreferenced screenshot was first seen. */
const MARKER = ".sweep.json";

/** Tables the sweep reads references from. */
export interface SweepTables {
  snapshots: Table;
  baselines: Table;
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
  const objects = (await deps.storage.list(dir)).filter((path) => path.endsWith(".png"));
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
    if (clock.now - seen >= clock.graceMs && !(await isReferenced(deps, projectId, path))) {
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
            eq(column(table, "projectId"), projectId),
            like(column(table, "screenshotPath"), `${contentDir(projectId)}/%`),
          ),
        })) as unknown as { screenshotPath: string }[],
    ),
  );
  return new Set(rows.flat().map((row) => row.screenshotPath));
}

async function isReferenced(deps: SweepDeps, projectId: string, path: string): Promise<boolean> {
  const hits = await Promise.all(
    [deps.tables.snapshots, deps.tables.baselines].map(
      async (table) =>
        (
          await deps.db.list(table, {
            where: and(
              eq(column(table, "projectId"), projectId),
              eq(column(table, "screenshotPath"), path),
            ),
            limit: 1,
          })
        ).length > 0,
    ),
  );
  return hits.some(Boolean);
}

function column(table: Table, name: string): Column {
  return getTableColumns(table)[name] as Column;
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
