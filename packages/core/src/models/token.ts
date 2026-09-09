/** CI tokens for project-scoped API access. */
import { and, eq } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Token } from "../schema/token.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link TokenModel}. */
export interface TokenTables {
  tokens: { projectId: SQLWrapper; id: SQLWrapper; hash: SQLWrapper } & Table & {
      $inferSelect: Token;
      $inferInsert: Token;
    };
}

/** Data operations for CI tokens. */
export class TokenModel {
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: TokenTables,
  ) {}

  /**
   * Create a token record storing its hash.
   *
   * @param projectId - Project ID.
   * @param name - Token name.
   * @param hash - Hashed token value.
   * @returns The created token.
   */
  async create(projectId: string, name: string, hash: string): Promise<Token> {
    return await this.db.insert(this.tables.tokens, {
      id: ulid(),
      projectId,
      name,
      hash,
      createdAt: new Date().toISOString(),
    } as never);
  }

  /** List all tokens for a project. */
  async list(projectId: string): Promise<Token[]> {
    return await this.db.list(this.tables.tokens, {
      where: eq(this.tables.tokens.projectId, projectId),
    });
  }

  /** Fetch a token by id within a project, or null if not found. */
  async get(projectId: string, id: string): Promise<Token | null> {
    const rows = await this.db.list(this.tables.tokens, {
      where: and(eq(this.tables.tokens.projectId, projectId), eq(this.tables.tokens.id, id)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** Fetch a token by its hashed value, or null if not found. */
  async findByHash(hash: string): Promise<Token | null> {
    const rows = await this.db.list(this.tables.tokens, {
      where: eq(this.tables.tokens.hash, hash),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** Delete a token by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(this.tables.tokens, id);
  }
}
