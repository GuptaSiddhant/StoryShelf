/** Snapshot records for captured stories within a build. */
import { and, eq, inArray } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import type { SnapshotStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link SnapshotModel}. */
export interface SnapshotTables {
  snapshots: Table;
}

/** Data operations for snapshot records. */
export class SnapshotModel {
  private readonly tables: SnapshotTables;
  private readonly db: DatabaseAdapter;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(db: DatabaseAdapter, tables?: SnapshotTables) {
    this.db = db;
    this.tables = tables ?? { snapshots: db.tables.snapshots };
  }

  /**
   * Create a snapshot for a story within a build.
   *
   * @param projectId - Project ID.
   * @param buildId - Build ID.
   * @param input - Snapshot creation input.
   * @returns The created snapshot.
   */
  async create(projectId: string, buildId: string, input: SnapshotCreateInput): Promise<Snapshot> {
    const now = new Date().toISOString();
    return (await this.db.insert(this.tables.snapshots, {
      id: ulid(),
      projectId,
      buildId,
      storyId: input.storyId,
      storyName: input.storyName,
      storyTitle: input.storyTitle,
      storyImportPath: input.storyImportPath,
      designUrl: input.designUrl ?? null,
      viewportName: input.viewportName,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      screenshotPath: input.screenshotPath,
      infraHash: input.infraHash ?? null,
      envChange: input.envChange ?? null,
      inherited: input.inherited ?? false,
      baselineId: input.baselineId ?? null,
      baselineVersion: input.baselineVersion ?? null,
      mode: input.mode ?? null,
      browser: input.browser ?? DEFAULT_BROWSER,
      durationMs: input.durationMs ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })) as unknown as Snapshot;
  }

  /**
   * Delete the rendered snapshots a shard is about to write again: rows of `(story, engine)` pairs
   * in `work`, so a rerun starts from a clean slate instead of colliding with rows an earlier,
   * interrupted run left behind. Inherited rows are kept: the plan wrote them, for engines or
   * viewports this shard does not render.
   */
  async removeRendered(
    buildId: string,
    work: readonly { browser: string; storyIds: ReadonlySet<string> }[],
  ): Promise<number> {
    const doomed = (await this.listByBuild(buildId)).filter(
      (row) =>
        !row.inherited &&
        work.some(
          (engine) =>
            engine.browser === (row.browser ?? DEFAULT_BROWSER) && engine.storyIds.has(row.storyId),
        ),
    );
    await this.#removeAll(doomed);
    return doomed.length;
  }

  /** Delete every snapshot of a build: a new plan of it starts clean. */
  async removeForBuild(buildId: string): Promise<number> {
    const doomed = await this.listByBuild(buildId);
    await this.#removeAll(doomed);
    return doomed.length;
  }

  async #removeAll(rows: readonly Snapshot[]): Promise<void> {
    await Promise.all(
      rows.map(async (row) => {
        await this.db.remove(this.tables.snapshots, row.id);
      }),
    );
  }

  /**
   * Milliseconds each story cost on one build, summed over its viewports and engines. Stories the
   * renderer did not time are left out, so an empty map means this build carries no timings.
   */
  async durationsByStory(buildId: string): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    for (const row of await this.listByBuild(buildId)) {
      if (typeof row.durationMs === "number") {
        totals.set(row.storyId, (totals.get(row.storyId) ?? 0) + row.durationMs);
      }
    }
    return totals;
  }

  /** List all snapshots belonging to a build. */
  async listByBuild(buildId: string): Promise<Snapshot[]> {
    return (await this.db.list(this.tables.snapshots, {
      where: eq(col(this.tables.snapshots, "buildId"), buildId),
    })) as unknown as Snapshot[];
  }

  /**
   * Every snapshot of a story file across the project's builds. Index paths are
   * stored raw (`./src/A.stories.tsx`), so both spellings of `importPath` match.
   */
  async listByImportPath(projectId: string, importPath: string): Promise<Snapshot[]> {
    const bare = importPath.replace(/^(?:\.\/)+/u, "");
    return (await this.db.list(this.tables.snapshots, {
      where: and(
        eq(col(this.tables.snapshots, "projectId"), projectId),
        inArray(col(this.tables.snapshots, "storyImportPath"), [bare, `./${bare}`]),
      ),
    })) as unknown as Snapshot[];
  }

  /** Fetch a snapshot by id, or null if not found. */
  async get(id: string): Promise<Snapshot | null> {
    return (await this.db.get(this.tables.snapshots, id)) as unknown as Snapshot | null;
  }

  /** Update mutable fields of a snapshot. */
  async update(id: string, patch: Partial<Snapshot>): Promise<Snapshot> {
    return (await this.db.update(this.tables.snapshots, id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    })) as unknown as Snapshot;
  }

  /** Set the status of a snapshot. */
  async setStatus(id: string, status: SnapshotStatus): Promise<Snapshot> {
    return await this.update(id, { status });
  }

  /** Record a reviewer's decision on a snapshot. */
  async review(id: string, status: SnapshotStatus, userId: string | null): Promise<Snapshot> {
    return await this.update(id, {
      status,
      reviewedBy: userId,
      reviewedAt: new Date().toISOString(),
    });
  }
}

/** Input for creating a snapshot. */
export interface SnapshotCreateInput {
  storyId: string;
  storyName: string;
  storyTitle: string;
  storyImportPath?: string;
  /** Figma URL declared by the story (`parameters.design` / `storyshelf.figma`). */
  designUrl?: string | null;
  viewportName: string;
  viewportWidth: number;
  viewportHeight: number;
  screenshotPath: string;
  infraHash?: string | null;
  /** JSON `EnvironmentChange` when accepted as an environment migration. */
  envChange?: string | null;
  inherited?: boolean;
  baselineId?: string | null;
  baselineVersion?: string | null;
  /** Resolved mode definition as JSON (display/capture only). */
  mode?: string | null;
  /** Engine the screenshot was captured with (default chromium). */
  browser?: string;
  /** Milliseconds the renderer spent on this capture, when it reported any. */
  durationMs?: number | null;
}
