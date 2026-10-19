/** A user's own OAuth connections to external services: encrypted tokens, lazy refresh on use. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { OAuthClient, OAuthTokens } from "../adapters/oauth.ts";
import type { UserConnection } from "../schema/connection.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link ConnectionModel}. */
export interface ConnectionTables {
  userConnections: Table;
}

/** Refresh this long before expiry so a call never starts with a token about to lapse. */
const REFRESH_MARGIN_MS = 60_000;

/** In-flight refreshes by connection, so concurrent page views refresh once (per process). */
const refreshing = new Map<string, Promise<string | null>>();

/**
 * Data operations for user OAuth connections, addressed by `(user, service)`.
 * Plaintext only leaves through {@link accessToken}; a token is refreshed lazily,
 * when its owner (or a request on their behalf) needs it — never in the background.
 */
export class ConnectionModel {
  private readonly tables: ConnectionTables;
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly secret?: SecretInput,
    tables?: ConnectionTables,
  ) {
    this.tables = tables ?? { userConnections: db.tables.userConnections };
  }

  /** The connection row (never the plaintext), or null. */
  async info(userId: string, service: string): Promise<UserConnection | null> {
    const columns = getTableColumns(this.tables.userConnections);
    const column = (name: string): SQLWrapper => columns[name] as unknown as SQLWrapper;
    const rows = (await this.db.list(this.tables.userConnections, {
      where: and(eq(column("userId"), userId), eq(column("service"), service)),
      limit: 1,
    })) as unknown as UserConnection[];
    return rows[0] ?? null;
  }

  /** Every connection of a user (no plaintext), for a "connected apps" list. */
  async listForUser(userId: string): Promise<UserConnection[]> {
    const columns = getTableColumns(this.tables.userConnections);
    return (await this.db.list(this.tables.userConnections, {
      where: eq(columns["userId"] as unknown as SQLWrapper, userId),
    })) as unknown as UserConnection[];
  }

  /** Store (or replace) a connection from fresh tokens; resets it to healthy. */
  async connect(userId: string, service: string, tokens: OAuthTokens): Promise<void> {
    const now = new Date().toISOString();
    const values = {
      tokenEncrypted: encrypt(this.secret, tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? encrypt(this.secret, tokens.refreshToken) : null,
      expiresAt: tokens.expiresAt,
      status: "ok",
      updatedAt: now,
    };
    const existing = await this.info(userId, service);
    if (existing) {
      await this.db.update(this.tables.userConnections, existing.id, values);
      return;
    }
    await this.db.insert(this.tables.userConnections, {
      id: ulid(),
      userId,
      service,
      createdAt: now,
      ...values,
    });
  }

  /** Remove a connection. */
  async remove(userId: string, service: string): Promise<void> {
    const existing = await this.info(userId, service);
    if (existing) await this.db.remove(this.tables.userConnections, existing.id);
  }

  /**
   * A usable access token, refreshing it (once, under concurrent calls) when it is
   * about to expire. A failed refresh marks the connection `expired` and returns
   * null until the user reconnects.
   */
  async accessToken(
    userId: string,
    service: string,
    oauth?: Pick<OAuthClient, "refresh">,
    now = new Date(),
  ): Promise<string | null> {
    const row = await this.info(userId, service);
    if (!row || row.status === "expired") return null;
    if (!isExpiring(row.expiresAt, now)) return decryptCredential(this.secret, row.tokenEncrypted);
    const inFlight = refreshing.get(row.id);
    if (inFlight) return await inFlight;
    const pending = this.refreshOnce(row, oauth).finally(() => {
      refreshing.delete(row.id);
    });
    refreshing.set(row.id, pending);
    return await pending;
  }

  private async refreshOnce(
    row: UserConnection,
    oauth: Pick<OAuthClient, "refresh"> | undefined,
  ): Promise<string | null> {
    try {
      if (!oauth || !row.refreshTokenEncrypted) throw new Error("connection cannot be refreshed");
      const tokens = await oauth.refresh({
        refreshToken: decryptCredential(this.secret, row.refreshTokenEncrypted),
      });
      await this.db.update(this.tables.userConnections, row.id, {
        tokenEncrypted: encrypt(this.secret, tokens.accessToken),
        refreshTokenEncrypted: tokens.refreshToken
          ? encrypt(this.secret, tokens.refreshToken)
          : row.refreshTokenEncrypted,
        expiresAt: tokens.expiresAt,
        status: "ok",
        updatedAt: new Date().toISOString(),
      });
      return tokens.accessToken;
    } catch {
      await this.db.update(this.tables.userConnections, row.id, {
        status: "expired",
        updatedAt: new Date().toISOString(),
      });
      return null;
    }
  }
}

/** Expiring within the margin (null never expires). */
function isExpiring(expiresAt: string | null, now: Date): boolean {
  return expiresAt !== null && Date.parse(expiresAt) - now.getTime() < REFRESH_MARGIN_MS;
}
