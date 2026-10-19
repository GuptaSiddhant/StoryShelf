/** Project and site-wide notification channel subscriptions. */
import { eq, isNull } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { decryptCredential, encrypt, type SecretInput } from "../utils/encrypt.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

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
  private readonly secret?: SecretInput;
  private readonly db: DatabaseAdapter;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles (defaults to the adapter's tables).
   * @param secret - Server secret for channel-secret encryption.
   */
  constructor(db: DatabaseAdapter, tables?: NotificationChannelTables, secret?: SecretInput) {
    this.db = db;
    this.tables = tables ?? { notificationChannels: db.tables.notificationChannels };
    this.secret = secret;
  }

  /** List channels for a project. */
  async list(projectId: string): Promise<NotificationChannelRow[]> {
    return (await this.db.list(this.tables.notificationChannels, {
      where: eq(col(this.tables.notificationChannels, "projectId"), projectId),
    })) as unknown as NotificationChannelRow[];
  }

  /** List site-wide admin channels (`project_id IS NULL`). */
  async listSystem(): Promise<NotificationChannelRow[]> {
    return (await this.db.list(this.tables.notificationChannels, {
      where: isNull(col(this.tables.notificationChannels, "projectId")),
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
      where: eq(col(this.tables.notificationChannels, "id"), id),
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
    return decryptCredential(this.secret, row.secretEncrypted);
  }

  /** Validate channel input against the matching notifier's schema. */
  static validateInput(
    notifiers: readonly NotifierProvider[],
    provider: string,
    config: unknown,
  ): { ok: true } | { ok: false; field: "provider" | "config"; message: string } {
    const descriptor = notifiers.find((candidate) => candidate.metadata.kind === provider);
    if (!descriptor) {
      return { ok: false, field: "provider", message: `Unknown provider: ${provider}` };
    }
    const parsed = descriptor.metadata.schema.safeParse(config);
    return parsed.success
      ? { ok: true }
      : { ok: false, field: "config", message: parsed.error.message };
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
