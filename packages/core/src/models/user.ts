/** User lookups for token and membership resolution. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { User } from "../schema/user.ts";

/** Tables required by {@link UserModel}. */
export interface UserTables {
  users: Table;
}

/** Data operations for users. */
export class UserModel {
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: UserTables,
  ) {}

  /** Fetch a user by id, or null if not found (e.g. deleted after tokens were minted). */
  async get(id: string): Promise<User | null> {
    const rows = (await this.db.list(this.tables.users, {
      where: eq(getTableColumns(this.tables.users)["id"] as unknown as SQLWrapper, id),
      limit: 1,
    })) as unknown as User[];
    return rows[0] ?? null;
  }

  /**
   * Insert or update a user row from an authenticated identity (login sync).
   * Email, name, avatar, and site role refresh on every login; the row id
   * (the provider `sub`) is stable.
   */
  async upsert(input: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    role: User["role"];
  }): Promise<User> {
    const now = new Date().toISOString();
    const existing = await this.get(input.id);
    if (!existing) {
      return (await this.db.insert(this.tables.users, {
        id: input.id,
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl ?? null,
        role: input.role,
        lastLoginAt: now,
        createdAt: now,
      })) as unknown as User;
    }
    return (await this.db.update(this.tables.users, existing.id, {
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl ?? null,
      role: input.role,
      lastLoginAt: now,
    })) as unknown as User;
  }
}
