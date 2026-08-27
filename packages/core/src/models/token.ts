import { eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { tokens, type Token } from "../schema.ts";
import { ulid } from "../utils/ulid.ts";

export class TokenModel {
  constructor(private readonly db: DatabaseAdapter) {}

  async create(projectId: string, name: string, hash: string): Promise<Token> {
    return this.db.insert(tokens, {
      id: ulid(),
      projectId,
      name,
      hash,
      createdAt: new Date().toISOString(),
    });
  }

  async list(projectId: string): Promise<Token[]> {
    return this.db.list(tokens, { where: eq(tokens.projectId, projectId) });
  }

  async findByHash(hash: string): Promise<Token | null> {
    const rows = await this.db.list(tokens, { where: eq(tokens.hash, hash), limit: 1 });
    return rows[0] ?? null;
  }

  async remove(id: string): Promise<void> {
    await this.db.remove(tokens, id);
  }
}

export type { Token };
