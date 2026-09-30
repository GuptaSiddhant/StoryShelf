/** Project and site-wide notification channel subscriptions. */
import { eq, getTableColumns, isNull } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { decrypt, encrypt } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link NotificationChannelModel}. */
export interface NotificationChannelTables {
  notificationChannels: Table;
}

/** Input for creating a notification channel. */
export interface NotificationChannelCreateInput {
  projectId: string | null;
  provider: string;
  config: Record<string, unknown>;
  secret?: string;
  events?: string[];
  enabled?: boolean;
}

/** Data operations for notification channels. */
export class NotificationChannelModel {
  private readonly tables: NotificationChannelTables;
  private readonly secret?: string;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles (defaults to the adapter's tables).
   * @param secret - Server secret for channel-secret encryption.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: NotificationChannelTables,
    secret?: string,
  ) {
    this.tables = tables ?? { notificationChannels: db.tables.notificationChannels };
    this.secret = secret;
  }

  /** List channels for a project. */
  async list(projectId: string): Promise<NotificationChannelRow[]> {
    return (await this.db.list(this.tables.notificationChannels, {
      where: eq(this.column("projectId"), projectId),
    })) as unknown as NotificationChannelRow[];
  }

  /** List site-wide admin channels (`project_id IS NULL`). */
  async listSystem(): Promise<NotificationChannelRow[]> {
    return (await this.db.list(this.tables.notificationChannels, {
      where: isNull(this.column("projectId")),
    })) as unknown as NotificationChannelRow[];
  }

  /** Create a channel (secret encrypted at rest when provided). */
  async create(input: NotificationChannelCreateInput): Promise<NotificationChannelRow> {
    const now = new Date().toISOString();
    return (await this.db.insert(this.tables.notificationChannels, {
      id: ulid(),
      projectId: input.projectId,
      provider: input.provider,
      config: JSON.stringify(input.config),
      secretEncrypted: input.secret ? encrypt(this.secret, input.secret) : null,
      events: input.events && input.events.length > 0 ? JSON.stringify(input.events) : null,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    })) as unknown as NotificationChannelRow;
  }

  /** Fetch a channel by id, or null. */
  async get(id: string): Promise<NotificationChannelRow | null> {
    const rows = (await this.db.list(this.tables.notificationChannels, {
      where: eq(this.column("id"), id),
      limit: 1,
    })) as unknown as NotificationChannelRow[];
    return rows[0] ?? null;
  }

  /** Remove a channel by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(this.tables.notificationChannels, id);
  }

  /** Decrypt the secret for a stored row (in memory only, at send time). */
  decryptSecret(row: NotificationChannelRow): string {
    if (!row.secretEncrypted) {
      throw new Error("Channel has no secret");
    }
    return decrypt(this.secret, row.secretEncrypted);
  }

  /** Decode the JSON-serialized event list of a channel. */
  static eventsOf(row: NotificationChannelRow): string[] {
    return decodeEvents(row.events);
  }

  /** Decode the JSON-serialized config of a channel. */
  static configOf(row: NotificationChannelRow): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(row.config);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private column(name: string): SQLWrapper {
    return getTableColumns(this.tables.notificationChannels)[name] as unknown as SQLWrapper;
  }
}

/** Decode a JSON event list column (empty = all events). */
function decodeEvents(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((event): event is string => typeof event === "string")
      : [];
  } catch {
    return [];
  }
}
