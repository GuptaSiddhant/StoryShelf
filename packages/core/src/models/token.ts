/** CI tokens for project-scoped API access. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Token } from "../schema/token.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link TokenModel}. */
export interface TokenTables {
  tokens: Table;
}

/** Data operations for CI tokens. */
export class TokenModel {
  private readonly tables: TokenTables;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: TokenTables,
  ) {
    this.tables = tables ?? { tokens: db.tables.tokens };
  }

  /**
   * Create a token record storing its hash.
   *
   * @param projectId - Project ID.
   * @param input - Token name, hash, and optional owning user ID (null for
   * legacy/admin-token minting; such tokens resolve as viewer).
   * @returns The created token.
   */
  async create(
    projectId: string,
    input: { name: string; hash: string; userId?: string | null },
  ): Promise<Token> {
    return (await this.db.insert(this.tables.tokens, {
      id: ulid(),
      projectId,
      name: input.name,
      hash: input.hash,
      userId: input.userId ?? null,
      createdAt: new Date().toISOString(),
    })) as unknown as Token;
  }

  /** List all tokens for a project. */
  async list(projectId: string): Promise<Token[]> {
    return (await this.db.list(this.tables.tokens, {
      where: eq(
        getTableColumns(this.tables.tokens)["projectId"] as unknown as SQLWrapper,
        projectId,
      ),
    })) as unknown as Token[];
  }

  /** Fetch a token by id within a project, or null if not found. */
  async get(projectId: string, id: string): Promise<Token | null> {
    const rows = (await this.db.list(this.tables.tokens, {
      where: and(
        eq(getTableColumns(this.tables.tokens)["projectId"] as unknown as SQLWrapper, projectId),
        eq(getTableColumns(this.tables.tokens)["id"] as unknown as SQLWrapper, id),
      ),
      limit: 1,
    })) as unknown as Token[];
    return rows[0] ?? null;
  }

  /** Fetch a token by its hashed value, or null if not found. */
  async findByHash(hash: string): Promise<Token | null> {
    const rows = (await this.db.list(this.tables.tokens, {
      where: eq(getTableColumns(this.tables.tokens)["hash"] as unknown as SQLWrapper, hash),
      limit: 1,
    })) as unknown as Token[];
    return rows[0] ?? null;
  }

  /** Delete a token by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(this.tables.tokens, id);
  }
}
