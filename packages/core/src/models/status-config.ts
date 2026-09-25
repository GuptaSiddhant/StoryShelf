/* oxlint-disable eslint/no-await-in-loop, typescript/promise-function-async, eslint/require-await */
/** Per-project git-provider status check configurations. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { ProjectStatusConfig } from "../schema/status-config.ts";
import { decrypt, encrypt } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link StatusConfigModel}. */
export interface StatusConfigTables {
  projectStatusConfigs: Table;
}

/** Data operations for per-project status provider configs. */
export class StatusConfigModel {
  private readonly tables: StatusConfigTables;
  private readonly secret: string | undefined;
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: StatusConfigTables,
    secret?: string,
  ) {
    this.tables = tables ?? { projectStatusConfigs: db.tables.projectStatusConfigs };
    this.secret = secret;
  }

  /** List all status configs for a project. */
  async list(projectId: string): Promise<ProjectStatusConfig[]> {
    return (await this.db.list(this.tables.projectStatusConfigs, {
      where: eq(
        getTableColumns(this.tables.projectStatusConfigs)["projectId"] as unknown as SQLWrapper,
        projectId,
      ),
    })) as unknown as ProjectStatusConfig[];
  }

  /** Fetch a config by id scoped to a project, or null. */
  async get(projectId: string, id: string): Promise<ProjectStatusConfig | null> {
    const rows = (await this.db.list(this.tables.projectStatusConfigs, {
      where: eq(
        getTableColumns(this.tables.projectStatusConfigs)["id"] as unknown as SQLWrapper,
        id,
      ),
      limit: 1,
    })) as unknown as ProjectStatusConfig[];
    const found = rows[0] ?? null;
    return found?.projectId === projectId ? found : null;
  }

  /** Decrypt the token for a stored row. */
  decryptToken(row: ProjectStatusConfig): string {
    return decrypt(this.secret, row.tokenEncrypted);
  }

  /** Parse the JSON config column. */
  static parseConfig(row: ProjectStatusConfig): unknown {
    return JSON.parse(row.config) as unknown;
  }

  async create(projectId: string, input: StatusConfigCreateInput): Promise<ProjectStatusConfig> {
    const now = new Date().toISOString();
    return (await this.db.insert(this.tables.projectStatusConfigs, {
      id: ulid(),
      projectId,
      provider: input.provider,
      config: JSON.stringify(input.config),
      tokenEncrypted: encrypt(this.secret, input.token),
      createdAt: now,
      updatedAt: now,
    })) as unknown as ProjectStatusConfig;
  }

  async remove(projectId: string, id: string): Promise<void> {
    const existing = await this.get(projectId, id);
    if (existing) {
      await this.db.remove(this.tables.projectStatusConfigs, existing.id);
    }
  }

  async removeByProject(projectId: string): Promise<void> {
    const rows = await this.list(projectId);
    for (const row of rows) {
      await this.db.remove(this.tables.projectStatusConfigs, row.id);
    }
  }
}

/** Input for creating a git-provider status config. */
export interface StatusConfigCreateInput {
  provider: string;
  config: unknown;
  token: string;
}
