/** Encrypted design-provider credentials: the project-wide token an admin pastes. */
import { and, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { DesignCredential } from "../schema/design.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";
import type { DesignCredentialStatus } from "./design-resolve.ts";

/** Tables required by {@link DesignCredentialModel}. */
export interface DesignCredentialTables {
  designCredentials: Table;
}

/** Cache scope of the shared project credential (`design_nodes.viewer_id`); a user id marks a member's own connection. */
export const PROJECT_SCOPE = "";

type Fields = Pick<
  DesignCredential,
  "tokenEncrypted" | "status" | "checkedAt" | "createdAt" | "updatedAt"
>;

/**
 * Data operations for design credentials. Every method addresses one
 * `(project, provider)` row. Plaintext only ever leaves through {@link get}.
 */
export class DesignCredentialModel {
  private readonly tables: DesignCredentialTables;
  private readonly db: DatabaseAdapter;
  private readonly secret?: SecretInput;

  constructor(db: DatabaseAdapter, secret?: SecretInput, tables?: DesignCredentialTables) {
    this.db = db;
    this.secret = secret;
    this.tables = tables ?? { designCredentials: db.tables.designCredentials };
  }

  /** The credential row (never the plaintext), or null. */
  async info(projectId: string, provider: string): Promise<DesignCredential | null> {
    const rows = (await this.db.list(this.tables.designCredentials, {
      where: and(
        eq(col(this.tables.designCredentials, "projectId"), projectId),
        eq(col(this.tables.designCredentials, "provider"), provider),
      ),
      limit: 1,
    })) as unknown as DesignCredential[];
    return rows[0] ?? null;
  }

  /** Decrypted access token for API calls, or null when none is set. */
  async get(projectId: string, provider: string): Promise<string | null> {
    const row = await this.info(projectId, provider);
    return row ? decryptCredential(this.secret, row.tokenEncrypted) : null;
  }

  /**
   * Store (or rotate) a pasted token. A new credential restarts the rotation
   * clock (`createdAt`) and resets health to `unknown`.
   */
  async set(projectId: string, provider: string, token: string): Promise<void> {
    const now = new Date().toISOString();
    const values: Fields = {
      tokenEncrypted: encrypt(this.secret, token),
      status: "unknown",
      checkedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    if (await this.replace(projectId, provider, values)) return;
    try {
      await this.db.insert(this.tables.designCredentials, {
        id: ulid(),
        projectId,
        provider,
        ...values,
      });
    } catch (error) {
      // A concurrent writer inserted first (unique project/provider): rotate theirs instead.
      if (!(await this.replace(projectId, provider, values))) throw error;
    }
  }

  /** Delete a credential. */
  async remove(projectId: string, provider: string): Promise<void> {
    const existing = await this.info(projectId, provider);
    if (existing) await this.db.remove(this.tables.designCredentials, existing.id);
  }

  /** Record the last observed API outcome; never moves the rotation age. */
  async recordStatus(
    projectId: string,
    provider: string,
    status: DesignCredentialStatus,
  ): Promise<void> {
    const existing = await this.info(projectId, provider);
    if (!existing) return;
    await this.db.update(this.tables.designCredentials, existing.id, {
      status,
      checkedAt: new Date().toISOString(),
    });
  }

  private async replace(projectId: string, provider: string, values: Fields): Promise<boolean> {
    const existing = await this.info(projectId, provider);
    if (!existing) return false;
    await this.db.update(this.tables.designCredentials, existing.id, {
      ...values,
    });
    return true;
  }
}
