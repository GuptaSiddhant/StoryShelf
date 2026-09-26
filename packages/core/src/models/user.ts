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
  private readonly tables: UserTables;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: UserTables,
  ) {
    this.tables = tables ?? { users: db.tables.users };
  }

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
   * (the provider `sub`) is stable. Preserves `displayNameOverride` so a
   * user-edited name survives IdP refresh; `passwordHash` and `disabled`
   * are never clobbered by SSO sync.
   */
  async upsert(input: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
    role: User["role"];
    authProvider?: User["authProvider"];
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
        passwordHash: null,
        displayNameOverride: null,
        authProvider: input.authProvider ?? "oidc",
        disabled: false,
      })) as unknown as User;
    }
    return (await this.db.update(this.tables.users, existing.id, {
      email: input.email,
      // Keep a user-edited display name: `name` stays the IdP value,
      // `displayNameOverride` is the source of truth for rendering.
      name: input.name,
      avatarUrl: input.avatarUrl ?? null,
      role: input.role,
      lastLoginAt: now,
    })) as unknown as User;
  }

  /** Update the display name override for a user (profile edit). */
  async setDisplayNameOverride(id: string, displayName: string | null): Promise<User> {
    return (await this.db.update(this.tables.users, id, {
      displayNameOverride: displayName?.trim() ? displayName.trim() : null,
    })) as unknown as User;
  }
}
