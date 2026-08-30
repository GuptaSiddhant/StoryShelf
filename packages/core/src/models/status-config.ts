/* oxlint-disable eslint/no-await-in-loop, typescript/promise-function-async, eslint/require-await */
import { eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { projectStatusConfigs, type ProjectStatusConfig } from "../schema.ts";
import { decrypt, encrypt } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";

export interface StatusConfigCreateInput {
  provider: string;
  config: unknown;
  token: string;
}

/** Data operations for per-project status provider configs. */
export class StatusConfigModel {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly secret: string | undefined,
  ) {}

  /** List all status configs for a project. */
  async list(projectId: string): Promise<ProjectStatusConfig[]> {
    return await this.db.list(projectStatusConfigs, { where: eq(projectStatusConfigs.projectId, projectId) });
  }

  /** Fetch a config by id scoped to a project, or null. */
  async get(projectId: string, id: string): Promise<ProjectStatusConfig | null> {
    const rows = await this.db.list(projectStatusConfigs, { where: eq(projectStatusConfigs.id, id), limit: 1 });
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
    return await this.db.insert(projectStatusConfigs, {
      id: ulid(),
      projectId,
      provider: input.provider,
      config: JSON.stringify(input.config),
      tokenEncrypted: encrypt(this.secret, input.token),
      createdAt: now,
      updatedAt: now,
    });
  }

  async remove(projectId: string, id: string): Promise<void> {
    const existing = await this.get(projectId, id);
    if (existing) {
      await this.db.remove(projectStatusConfigs, existing.id);
    }
  }

  async removeByProject(projectId: string): Promise<void> {
    const rows = await this.list(projectId);
    for (const row of rows) {
      await this.db.remove(projectStatusConfigs, row.id);
    }
  }
}

export type { ProjectStatusConfig };
