/** Web push devices (ADR 0048): one row per browser endpoint, owned by a user. */
import { and, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { PushSubscriptionRow } from "../schema/push.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link PushSubscriptionModel}. */
export interface PushSubscriptionTables {
  pushSubscriptions: Table;
}

/** What a browser hands over when it subscribes. Never log any of it. */
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string | null;
}

/** Attempts at the failure counter before giving up on a contended row. */
const COUNTER_ATTEMPTS = 5;

/** Data operations for web push subscriptions. */
export class PushSubscriptionModel {
  private readonly tables: PushSubscriptionTables;
  private readonly db: DatabaseAdapter;

  /**
   * @param db - Database adapter.
   * @param tables - Table handles (defaults to the adapter's tables).
   */
  constructor(db: DatabaseAdapter, tables?: PushSubscriptionTables) {
    this.db = db;
    this.tables = tables ?? { pushSubscriptions: db.tables.pushSubscriptions };
  }

  /** Register a device, or replace the keys, owner and label of the row with this endpoint. */
  async add(userId: string, input: PushSubscriptionInput): Promise<PushSubscriptionRow> {
    const existing = await this.findByEndpoint(input.endpoint);
    if (existing) {
      return await this.replace(existing.id, userId, input);
    }
    try {
      return (await this.db.insert(this.tables.pushSubscriptions, {
        id: ulid(),
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        label: input.label ?? null,
        createdAt: new Date().toISOString(),
        lastSuccessAt: null,
        failureCount: 0,
      })) as unknown as PushSubscriptionRow;
    } catch (error) {
      // A concurrent registration of the same endpoint won the unique index: replace its row.
      const winner = await this.findByEndpoint(input.endpoint);
      if (!winner) {
        throw error;
      }
      return await this.replace(winner.id, userId, input);
    }
  }

  /** The row for a push endpoint, or null. */
  async findByEndpoint(endpoint: string): Promise<PushSubscriptionRow | null> {
    const rows = (await this.db.list(this.tables.pushSubscriptions, {
      where: eq(col(this.tables.pushSubscriptions, "endpoint"), endpoint),
      limit: 1,
    })) as unknown as PushSubscriptionRow[];
    return rows[0] ?? null;
  }

  /** Every device a user registered. */
  async listForUser(userId: string): Promise<PushSubscriptionRow[]> {
    return (await this.db.list(this.tables.pushSubscriptions, {
      where: eq(col(this.tables.pushSubscriptions, "userId"), userId),
    })) as unknown as PushSubscriptionRow[];
  }

  /** Delete a device by id (the push service answered 404 or 410). */
  async remove(id: string): Promise<void> {
    await this.db.remove(this.tables.pushSubscriptions, id);
  }

  /** Delete one of a user's own devices; false when the id is not theirs or not there. */
  async removeOwned(userId: string, id: string): Promise<boolean> {
    const rows = (await this.db.list(this.tables.pushSubscriptions, {
      where: and(
        eq(col(this.tables.pushSubscriptions, "id"), id),
        eq(col(this.tables.pushSubscriptions, "userId"), userId),
      ),
      limit: 1,
    })) as unknown as PushSubscriptionRow[];
    if (rows.length === 0) {
      return false;
    }
    await this.remove(id);
    return true;
  }

  /** A send was accepted: stamp the time and clear the failure count. */
  async recordSuccess(id: string, at: Date = new Date()): Promise<void> {
    await this.db.update(this.tables.pushSubscriptions, id, {
      lastSuccessAt: at.toISOString(),
      failureCount: 0,
    });
  }

  /** A send failed for a reason other than "gone": count it. Returns the new count. */
  async recordFailure(id: string, attemptsLeft: number = COUNTER_ATTEMPTS): Promise<number> {
    const table = this.tables.pushSubscriptions;
    const row = (await this.db.get(table, id)) as unknown as PushSubscriptionRow | null;
    if (!row) {
      return 0;
    }
    if (attemptsLeft === 0) {
      throw new Error("push subscription failure counter is contended");
    }
    const next = row.failureCount + 1;
    const won = (await this.db.updateWhere(
      table,
      id,
      { failureCount: next },
      eq(col(table, "failureCount"), row.failureCount),
    )) as unknown as PushSubscriptionRow | null;
    return won?.failureCount === next ? next : await this.recordFailure(id, attemptsLeft - 1);
  }

  private async replace(
    id: string,
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<PushSubscriptionRow> {
    return (await this.db.update(this.tables.pushSubscriptions, id, {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
      failureCount: 0,
    })) as unknown as PushSubscriptionRow;
  }
}
