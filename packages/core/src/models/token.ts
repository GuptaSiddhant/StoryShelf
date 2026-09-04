/** CI tokens for project-scoped API access. */
import { and, eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { tokens } from "../schema-tables.ts";
import type { Token } from "../schema.ts";
import { ulid } from "../utils/ulid.ts";

/** Data operations for CI tokens. */
export class TokenModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * Create a token record storing its hash.
   *
   * @param projectId - Project ID.
   * @param name - Token name.
   * @param hash - Hashed token value.
   * @returns The created token.
   */
  async create(projectId: string, name: string, hash: string): Promise<Token> {
    return await this.db.insert(tokens, {
      id: ulid(),
      projectId,
      name,
      hash,
      createdAt: new Date().toISOString(),
    });
  }

  /** List all tokens for a project. */
  async list(projectId: string): Promise<Token[]> {
    return await this.db.list(tokens, { where: eq(tokens.projectId, projectId) });
  }

  /** Fetch a token by id within a project, or null if not found. */
  async get(projectId: string, id: string): Promise<Token | null> {
    const rows = await this.db.list(tokens, {
      where: and(eq(tokens.projectId, projectId), eq(tokens.id, id)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** Fetch a token by its hashed value, or null if not found. */
  async findByHash(hash: string): Promise<Token | null> {
    const rows = await this.db.list(tokens, { where: eq(tokens.hash, hash), limit: 1 });
    return rows[0] ?? null;
  }

  /** Delete a token by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(tokens, id);
  }
}

export type { Token };
