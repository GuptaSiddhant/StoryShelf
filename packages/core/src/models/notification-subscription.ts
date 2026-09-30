/** Per-user opt-in rows for project notifications. */
import { and, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { NotificationSubscriptionRow } from "../schema/notification.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link NotificationSubscriptionModel}. */
export interface NotificationSubscriptionTables {
  notificationSubscriptions: Table;
}

/** Input for upserting a subscription (all fields optional except identity). */
export interface NotificationSubscriptionInput {
  events?: string[];
  via?: string[];
  enabled?: boolean;
}

/** Data operations for per-user notification subscriptions. */
export class NotificationSubscriptionModel {
  private readonly tables: NotificationSubscriptionTables;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles (defaults to the adapter's tables).
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: NotificationSubscriptionTables,
  ) {
    this.tables = tables ?? { notificationSubscriptions: db.tables.notificationSubscriptions };
  }

  /** Fetch a user's subscription for a project, or null (null = silent). */
  async getFor(projectId: string, userId: string): Promise<NotificationSubscriptionRow | null> {
    const projectScope = eq(this.column("projectId"), projectId);
    const userScope = eq(this.column("userId"), userId);
    const rows = (await this.db.list(this.tables.notificationSubscriptions, {
      where: and(projectScope, userScope),
      limit: 1,
    })) as unknown as NotificationSubscriptionRow[];
    return rows[0] ?? null;
  }

  /** List all subscriptions for a project (admin audit). */
  async list(projectId: string): Promise<NotificationSubscriptionRow[]> {
    return (await this.db.list(this.tables.notificationSubscriptions, {
      where: eq(this.column("projectId"), projectId),
    })) as unknown as NotificationSubscriptionRow[];
  }

  /** Create or replace a user's subscription for a project. */
  async upsert(
    projectId: string,
    userId: string,
    input: NotificationSubscriptionInput,
  ): Promise<NotificationSubscriptionRow> {
    const existing = await this.getFor(projectId, userId);
    if (existing) {
      return (await this.db.update(this.tables.notificationSubscriptions, existing.id, {
        events: encodeList(input.events),
        via: encodeList(input.via),
        enabled: input.enabled ?? true,
      })) as unknown as NotificationSubscriptionRow;
    }
    return (await this.db.insert(this.tables.notificationSubscriptions, {
      id: ulid(),
      projectId,
      userId,
      events: encodeList(input.events),
      via: encodeList(input.via),
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString(),
    })) as unknown as NotificationSubscriptionRow;
  }

  /** Remove a user's subscription (opt out). */
  async remove(projectId: string, userId: string): Promise<void> {
    const existing = await this.getFor(projectId, userId);
    if (existing) {
      await this.db.remove(this.tables.notificationSubscriptions, existing.id);
    }
  }

  /** Decode the JSON-serialized event list of a subscription. */
  static eventsOf(row: NotificationSubscriptionRow): string[] {
    return decodeList(row.events);
  }

  /** Decode the JSON-serialized channel list of a subscription. */
  static viaOf(row: NotificationSubscriptionRow): string[] {
    return decodeList(row.via);
  }

  private column(name: string): SQLWrapper {
    return getTableColumns(this.tables.notificationSubscriptions)[name] as unknown as SQLWrapper;
  }
}

/** Encode an optional string list (undefined/empty = all, stored as null). */
function encodeList(values: string[] | undefined): string | null {
  return values && values.length > 0 ? JSON.stringify(values) : null;
}

/** Decode a JSON list column (null = all). */
function decodeList(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}
