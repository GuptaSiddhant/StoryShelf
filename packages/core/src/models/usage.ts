/** Per-build package usage and cross-project package links. */
import { and, eq } from "drizzle-orm";
import type { SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter, TxStore } from "../adapters/database.ts";
import type { BuildPackageUsage, ProjectLink } from "../schema/usage.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link PackageUsageModel}. */
export interface PackageUsageTables {
  buildPackageUsage: Table;
  projectLinks: Table;
}

/** A usage row as reported by the CLI at upload time. */
export interface PackageUsageInput {
  storyImportPath: string;
  packageName: string;
  modulePath: string;
  version?: string | null;
}

/** A candidate upstream story: where it is defined and its Storybook id. */
export interface UpstreamStory {
  importPath: string;
  storyId: string;
}

/** `Button.stories.tsx` / `Button.js` / `Button/index.js` → `Button`. */
function componentStem(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  const last = parts.at(-1) ?? "";
  const file = last.replace(/(?:\.stories)?\.[cm]?[jt]sx?$|\.vue$|\.svelte$/u, "");
  return file === "index" ? (parts.at(-2) ?? file) : file;
}

/**
 * Pick the upstream story that documents the package module a story reaches.
 * Exact stem match only (`dist/Button.js` ↔ `Button.stories.tsx`): resolves to the
 * first story id of the single matching story file, or null when nothing matches
 * or several different files share the stem (callers then fall back to the library).
 */
export function matchUpstreamStory(
  modulePath: string,
  stories: readonly UpstreamStory[],
): string | null {
  const stem = componentStem(modulePath);
  if (!stem) {
    return null;
  }
  const matching = stories.filter((story) => componentStem(story.importPath) === stem);
  if (new Set(matching.map((story) => story.importPath)).size !== 1) {
    return null;
  }
  return matching.map((story) => story.storyId).toSorted()[0] ?? null;
}

/** Data operations for build package usage and project links. */
export class PackageUsageModel {
  private readonly tables: PackageUsageTables;

  private readonly db: DatabaseAdapter;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(db: DatabaseAdapter, tables?: PackageUsageTables) {
    this.db = db;
    this.tables = tables ?? {
      buildPackageUsage: db.tables.buildPackageUsage,
      projectLinks: db.tables.projectLinks,
    };
  }

  /**
   * Replace the usage rows of a build, so re-reporting is idempotent.
   * Runs in one transaction when the driver supports it and is serialized per
   * build, so concurrent re-reports leave exactly one report's rows.
   *
   * @returns The number of rows stored.
   */
  async replaceForBuild(
    projectId: string,
    buildId: string,
    rows: readonly PackageUsageInput[],
  ): Promise<number> {
    const table = this.tables.buildPackageUsage;
    const createdAt = new Date().toISOString();
    return await serialized(
      `usage:${buildId}`,
      async () =>
        await this.atomic(async (store) => {
          await removeAll(store, table, this.buildWhere(buildId));
          await Promise.all(
            rows.map(async (row) => {
              await store.insert(table, {
                id: ulid(),
                projectId,
                buildId,
                storyImportPath: row.storyImportPath,
                packageName: row.packageName,
                modulePath: row.modulePath,
                version: row.version ?? null,
                createdAt,
              });
            }),
          );
          return rows.length;
        }),
    );
  }

  /**
   * Explicitly remove all usage rows of a build (no reliance on FK cascade).
   *
   * @returns The number of rows removed.
   */
  async removeForBuild(buildId: string): Promise<number> {
    return await removeAll(this.db, this.tables.buildPackageUsage, this.buildWhere(buildId));
  }

  /** List all usage rows of a build. */
  async listForBuild(buildId: string): Promise<BuildPackageUsage[]> {
    return (await this.db.list(this.tables.buildPackageUsage, {
      where: this.buildWhere(buildId),
    })) as unknown as BuildPackageUsage[];
  }

  /** List the packages a downstream project links to upstream projects. */
  async listLinks(downstreamId: string): Promise<ProjectLink[]> {
    const table = this.tables.projectLinks;
    return (await this.db.list(table, {
      where: eq(col(table, "downstreamId"), downstreamId),
    })) as unknown as ProjectLink[];
  }

  /** List the usage rows of one story file within a build. */
  async listForStory(buildId: string, storyImportPath: string): Promise<BuildPackageUsage[]> {
    const table = this.tables.buildPackageUsage;
    return (await this.db.list(table, {
      where: and(
        eq(col(table, "buildId"), buildId),
        eq(col(table, "storyImportPath"), storyImportPath),
      ),
    })) as unknown as BuildPackageUsage[];
  }

  /**
   * Replace a downstream project's links with the given list, atomically when
   * the driver supports transactions and serialized per downstream project.
   *
   * @returns The stored links.
   */
  async replaceLinks(
    downstreamId: string,
    links: readonly { upstreamId: string; packageName: string }[],
  ): Promise<ProjectLink[]> {
    const table = this.tables.projectLinks;
    const where = eq(col(table, "downstreamId"), downstreamId);
    const createdAt = new Date().toISOString();
    return await serialized(
      `links:${downstreamId}`,
      async () =>
        await this.atomic(async (store) => {
          await removeAll(store, table, where);
          return await Promise.all(
            links.map(
              async (link) =>
                (await store.insert(table, {
                  id: ulid(),
                  downstreamId,
                  upstreamId: link.upstreamId,
                  packageName: link.packageName,
                  createdAt,
                })) as unknown as ProjectLink,
            ),
          );
        }),
    );
  }

  /** Run `work` in a transaction when the driver has one, else directly on the adapter. */
  private async atomic<R>(work: (store: TxStore) => Promise<R>): Promise<R> {
    return this.db.transact ? await this.db.transact(work) : await work(this.db);
  }

  private buildWhere(buildId: string): SQL {
    return eq(col(this.tables.buildPackageUsage, "buildId"), buildId);
  }
}

/** Delete every row of `table` matching `where`; returns the number removed. */
async function removeAll(store: TxStore, table: Table, where: SQL): Promise<number> {
  const rows = (await store.list(table, { where })) as unknown as { id: string }[];
  await Promise.all(
    rows.map(async (row) => {
      await store.remove(table, row.id);
    }),
  );
  return rows.length;
}

/** In-process tail of pending replaces, keyed by the rows they own. */
const pending = new Map<string, Promise<unknown>>();

/**
 * Chain `task` after any in-flight call with the same key so overlapping replaces
 * of the same rows never interleave (covers drivers without `transact` and
 * drivers whose transactions do not serialize callers sharing one connection).
 */
async function serialized<R>(key: string, task: () => Promise<R>): Promise<R> {
  const previous = pending.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => null);
  pending.set(key, tail);
  try {
    return await run;
  } finally {
    if (pending.get(key) === tail) {
      pending.delete(key);
    }
  }
}
