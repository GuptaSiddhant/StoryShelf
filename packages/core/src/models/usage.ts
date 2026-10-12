/** Per-build package usage and cross-project package links. */
import { and, eq, getTableColumns } from "drizzle-orm";
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

  /** List the usage rows of one story file within a build. */
  async listForStory(buildId: string, storyImportPath: string): Promise<BuildPackageUsage[]> {
    const table = this.tables.buildPackageUsage;
    const columns = getTableColumns(table);
    return (await this.db.list(table, {
      where: and(
        eq(columns["buildId"] as unknown as SQLWrapper, buildId),
        eq(columns["storyImportPath"] as unknown as SQLWrapper, storyImportPath),
      ),
    })) as unknown as BuildPackageUsage[];
  }

  /**
   * Replace a downstream project's links with the given list.
   *
   * @returns The stored links.
   */
  async replaceLinks(
    downstreamId: string,
    links: readonly { upstreamId: string; packageName: string }[],
  ): Promise<ProjectLink[]> {
    const table = this.tables.projectLinks;
    const existing = await this.listLinks(downstreamId);
    await Promise.all(
      existing.map(async (old) => {
        await this.db.remove(table, old.id);
      }),
    );
    const createdAt = new Date().toISOString();
    return await Promise.all(
      links.map(
        async (link) =>
          (await this.db.insert(table, {
            id: ulid(),
            downstreamId,
            upstreamId: link.upstreamId,
            packageName: link.packageName,
            createdAt,
          })) as unknown as ProjectLink,
      ),
    );
  }
}
