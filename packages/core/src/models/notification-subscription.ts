/** Per-user opt-in rows for project notifications. */
import { and, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { NotificationSubscriptionRow } from "../schema/notification.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link NotificationSubscriptionModel}. */
export interface NotificationSubscriptionTables {
  notificationSubscriptions: Table;
}

/** Input for upserting a subscription (all fields optional except identity). */
export interface NotificationSubscriptionInput {
  events?: string[];
  via?: string[];
  enabled?: boolean;
  /** `review:requested` on or off; left as stored when omitted (true for a new row). */
  reviewRequests?: boolean;
}

/** Data operations for per-user notification subscriptions. */
export class NotificationSubscriptionModel {
  private readonly tables: NotificationSubscriptionTables;
  private readonly db: DatabaseAdapter;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles (defaults to the adapter's tables).
   */
  constructor(db: DatabaseAdapter, tables?: NotificationSubscriptionTables) {
    this.db = db;
    this.tables = tables ?? { notificationSubscriptions: db.tables.notificationSubscriptions };
  }

  /** Fetch a user's subscription for a project, or null (null = silent). */
  async getFor(projectId: string, userId: string): Promise<NotificationSubscriptionRow | null> {
    const projectScope = eq(col(this.tables.notificationSubscriptions, "projectId"), projectId);
    const userScope = eq(col(this.tables.notificationSubscriptions, "userId"), userId);
    const rows = (await this.db.list(this.tables.notificationSubscriptions, {
      where: and(projectScope, userScope),
      limit: 1,
    })) as unknown as NotificationSubscriptionRow[];
    return rows[0] ?? null;
  }

  /** List all subscriptions for a project (admin audit). */
  async list(projectId: string): Promise<NotificationSubscriptionRow[]> {
    return (await this.db.list(this.tables.notificationSubscriptions, {
      where: eq(col(this.tables.notificationSubscriptions, "projectId"), projectId),
    })) as unknown as NotificationSubscriptionRow[];
  }

  /** List all subscriptions for a user (profile overview). */
  async listForUser(userId: string): Promise<NotificationSubscriptionRow[]> {
    return (await this.db.list(this.tables.notificationSubscriptions, {
      where: eq(col(this.tables.notificationSubscriptions, "userId"), userId),
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
        // Left out when not given, so a concurrent switch change is not overwritten by a stale read.
        ...(input.reviewRequests === undefined ? {} : { reviewRequests: input.reviewRequests }),
      })) as unknown as NotificationSubscriptionRow;
    }
    return (await this.db.insert(this.tables.notificationSubscriptions, {
      id: ulid(),
      projectId,
      userId,
      events: encodeList(input.events),
      via: encodeList(input.via),
      enabled: input.enabled ?? true,
      reviewRequests: input.reviewRequests ?? true,
      createdAt: new Date().toISOString(),
    })) as unknown as NotificationSubscriptionRow;
  }

  /**
   * Switch an existing subscription on or off, keeping its topics, channels and review-request
   * choice. Off keeps the row: deleting it would hand the person back to the default recipients,
   * so "stop emailing me" must stay recorded. Without a row there is nothing to switch.
   */
  async setEnabled(projectId: string, userId: string, enabled: boolean): Promise<void> {
    const existing = await this.getFor(projectId, userId);
    if (existing) {
      await this.db.update(this.tables.notificationSubscriptions, existing.id, { enabled });
    }
  }

  /**
   * Whether a row is only the record of "no review requests" (disabled, no topics, no channels,
   * review requests off), not an "Email me" opt-out. By design a row in this shape counts as that
   * placeholder even when it came from the API, and switching review requests back on removes it
   * (Architect decision on #542). It opts the person out of review requests and nothing else.
   */
  static isReviewOptOutOnly(row: NotificationSubscriptionRow): boolean {
    return !row.enabled && !row.reviewRequests && row.events === null && row.via === null;
  }

  /**
   * Turn `review:requested` on or off for a person, touching nothing else. Someone with no row
   * who turns it off gets a disabled one (no topics, no channels), so the opt-out is recorded
   * without subscribing them to anything. Turning it back on for exactly that placeholder
   * (disabled, no topics, no channels, review requests off) deletes it, which returns them to the
   * defaults. A disabled row with review requests still on is an "Email me" opt-out, never a
   * placeholder, so it stays and keeps them silent.
   */
  async setReviewRequests(projectId: string, userId: string, on: boolean): Promise<void> {
    const existing = await this.getFor(projectId, userId);
    if (!existing) {
      if (!on) {
        await this.upsert(projectId, userId, { enabled: false, reviewRequests: false });
      }
      return;
    }
    if (on && NotificationSubscriptionModel.isReviewOptOutOnly(existing)) {
      await this.remove(projectId, userId);
      return;
    }
    await this.writeReviewRequests(projectId, userId, existing, on);
  }

  /**
   * Store the switch. Adding `review:requested` to a topic list rewrites that list, so it only
   * lands if the list is still the one it was derived from; otherwise a concurrent save of new
   * topics would be lost, and the whole step is redone from the fresh row.
   */
  private async writeReviewRequests(
    projectId: string,
    userId: string,
    existing: NotificationSubscriptionRow,
    on: boolean,
  ): Promise<void> {
    const table = this.tables.notificationSubscriptions;
    const reconciled = on ? reconciledEvents(existing) : {};
    if (reconciled.events === undefined || existing.events === null) {
      await this.db.update(table, existing.id, { reviewRequests: on });
      return;
    }
    const won = (await this.db.updateWhere(
      table,
      existing.id,
      { reviewRequests: on, events: reconciled.events },
      eq(col(table, "events"), existing.events),
    )) as unknown as NotificationSubscriptionRow | null;
    if (won?.events !== reconciled.events) {
      await this.setReviewRequests(projectId, userId, on);
    }
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
}

/**
 * Turning review requests on must be able to take effect: a topic list saved before the switch
 * owned `review:requested` may leave it out, so it is added to the list (all else kept).
 */
function reconciledEvents(row: NotificationSubscriptionRow): { events?: string } {
  const listed = decodeList(row.events);
  if (listed.length === 0 || listed.includes("review:requested")) {
    return {};
  }
  return { events: JSON.stringify([...listed, "review:requested"]) };
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
