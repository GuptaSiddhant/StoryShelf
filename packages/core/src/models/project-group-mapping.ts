/** Project group-to-role mappings for OIDC team sync. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { ProjectGroupMapping } from "../schema/project-group-mapping.ts";
import type { ProjectRole } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link ProjectGroupMappingModel}. */
export interface ProjectGroupMappingTables {
  projectGroupMappings: Table;
}

/** Data operations for identity-provider group mappings. */
export class ProjectGroupMappingModel {
  private readonly tables: ProjectGroupMappingTables;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: ProjectGroupMappingTables,
  ) {
    this.tables = tables ?? { projectGroupMappings: db.tables.projectGroupMappings };
  }

  /** List all group mappings for a project. */
  async list(projectId: string): Promise<ProjectGroupMapping[]> {
    return (await this.db.list(this.tables.projectGroupMappings, {
      where: eq(
        getTableColumns(this.tables.projectGroupMappings)["projectId"] as unknown as SQLWrapper,
        projectId,
      ),
    })) as unknown as ProjectGroupMapping[];
  }

  /** Create a group mapping for a project. */
  async create(
    projectId: string,
    groupName: string,
    role: ProjectRole,
  ): Promise<ProjectGroupMapping> {
    return (await this.db.insert(this.tables.projectGroupMappings, {
      id: ulid(),
      projectId,
      groupName,
      role,
      createdAt: new Date().toISOString(),
    })) as unknown as ProjectGroupMapping;
  }

  /** Remove a group mapping by id within a project. */
  async remove(projectId: string, id: string): Promise<void> {
    const rows = (await this.db.list(this.tables.projectGroupMappings, {
      where: and(
        eq(getTableColumns(this.tables.projectGroupMappings)["id"] as unknown as SQLWrapper, id),
        eq(
          getTableColumns(this.tables.projectGroupMappings)["projectId"] as unknown as SQLWrapper,
          projectId,
        ),
      ),
      limit: 1,
    })) as unknown as ProjectGroupMapping[];
    if (rows[0]) {
      await this.db.remove(this.tables.projectGroupMappings, rows[0].id);
    }
  }
}
