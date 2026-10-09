/** Per-build package usage and cross-project package links. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { BuildPackageUsage, ProjectLink } from "../schema/usage.ts";
import { ulid } from "../utils/ulid.ts";

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

/** Data operations for build package usage and project links. */
export class PackageUsageModel {
  private readonly tables: PackageUsageTables;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: PackageUsageTables,
  ) {
    this.tables = tables ?? {
      buildPackageUsage: db.tables.buildPackageUsage,
      projectLinks: db.tables.projectLinks,
    };
  }

  /**
   * Replace the usage rows of a build, so re-reporting is idempotent.
   *
   * @returns The number of rows stored.
   */
  async replaceForBuild(
    projectId: string,
    buildId: string,
    rows: readonly PackageUsageInput[],
  ): Promise<number> {
    const table = this.tables.buildPackageUsage;
    const existing = await this.listForBuild(buildId);
    await Promise.all(
      existing.map(async (old) => {
        await this.db.remove(table, old.id);
      }),
    );
    const createdAt = new Date().toISOString();
    await Promise.all(
      rows.map(async (row) => {
        await this.db.insert(table, {
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
  }

  /** List all usage rows of a build. */
  async listForBuild(buildId: string): Promise<BuildPackageUsage[]> {
    const table = this.tables.buildPackageUsage;
    return (await this.db.list(table, {
      where: eq(getTableColumns(table)["buildId"] as unknown as SQLWrapper, buildId),
    })) as unknown as BuildPackageUsage[];
  }

  /** List the packages a downstream project links to upstream projects. */
  async listLinks(downstreamId: string): Promise<ProjectLink[]> {
    const table = this.tables.projectLinks;
    return (await this.db.list(table, {
      where: eq(getTableColumns(table)["downstreamId"] as unknown as SQLWrapper, downstreamId),
    })) as unknown as ProjectLink[];
  }
}
