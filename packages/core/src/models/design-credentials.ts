/** Encrypted design-provider credentials: the project-wide token and (later) per-user connections. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { DesignCredential } from "../schema/design.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";
import type { DesignCredentialStatus } from "./design-resolve.ts";

/** Tables required by {@link DesignCredentialModel}. */
export interface DesignCredentialTables {
  designCredentials: Table;
}

/** Project scope: the credential an admin set for the whole project (as opposed to a user's own). */
export const PROJECT_SCOPE = "";

type Fields = Pick<
  DesignCredential,
  "tokenEncrypted" | "status" | "checkedAt" | "createdAt" | "updatedAt"
>;

/**
 * Data operations for design credentials. Every method addresses one
 * `(project, provider, user)` row; `userId` defaults to the project-wide
 * credential. Plaintext only ever leaves through {@link getCredential}.
 */
export class DesignCredentialModel {
  private readonly tables: DesignCredentialTables;
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly secret?: SecretInput,
    tables?: DesignCredentialTables,
  ) {
    this.tables = tables ?? { designCredentials: db.tables.designCredentials };
  }

  /** The credential row (never the plaintext), or null. */
  async info(
    projectId: string,
    provider: string,
    userId = PROJECT_SCOPE,
  ): Promise<DesignCredential | null> {
    const columns = getTableColumns(this.tables.designCredentials);
    const column = (name: string): SQLWrapper => columns[name] as unknown as SQLWrapper;
    const rows = (await this.db.list(this.tables.designCredentials, {
      where: and(
        eq(column("projectId"), projectId),
        eq(column("provider"), provider),
        eq(column("userId"), userId),
      ),
      limit: 1,
    })) as unknown as DesignCredential[];
    return rows[0] ?? null;
  }

  /** Decrypted access token for API calls, or null when none is set. */
  async get(projectId: string, provider: string, userId = PROJECT_SCOPE): Promise<string | null> {
    const row = await this.info(projectId, provider, userId);
    return row ? decryptCredential(this.secret, row.tokenEncrypted) : null;
  }

  /**
   * Store (or rotate) a pasted token. A new credential restarts the rotation
   * clock (`createdAt`) and resets health to `unknown`.
   */
  async set(
    projectId: string,
    provider: string,
    token: string,
    userId = PROJECT_SCOPE,
  ): Promise<void> {
    const now = new Date().toISOString();
    const values: Fields = {
      tokenEncrypted: encrypt(this.secret, token),
      status: "unknown",
      checkedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    if (await this.replace(projectId, provider, userId, values)) return;
    try {
      await this.db.insert(this.tables.designCredentials, {
        id: ulid(),
        projectId,
        provider,
        userId,
        authType: "token",
        refreshTokenEncrypted: null,
        expiresAt: null,
        ...values,
      });
    } catch (error) {
      // A concurrent writer inserted first (unique project/provider/user): rotate theirs instead.
      if (!(await this.replace(projectId, provider, userId, values))) throw error;
    }
  }

  /** Delete a credential. */
  async remove(projectId: string, provider: string, userId = PROJECT_SCOPE): Promise<void> {
    const existing = await this.info(projectId, provider, userId);
    if (existing) await this.db.remove(this.tables.designCredentials, existing.id);
  }

  /** Record the last observed API outcome; never moves the rotation age. */
  async recordStatus(
    projectId: string,
    provider: string,
    status: DesignCredentialStatus,
    userId = PROJECT_SCOPE,
  ): Promise<void> {
    const existing = await this.info(projectId, provider, userId);
    if (!existing) return;
    await this.db.update(this.tables.designCredentials, existing.id, {
      status,
      checkedAt: new Date().toISOString(),
    });
  }

  private async replace(
    projectId: string,
    provider: string,
    userId: string,
    values: Fields,
  ): Promise<boolean> {
    const existing = await this.info(projectId, provider, userId);
    if (!existing) return false;
    await this.db.update(this.tables.designCredentials, existing.id, {
      ...values,
      authType: "token",
      refreshTokenEncrypted: null,
      expiresAt: null,
    });
    return true;
  }
}
