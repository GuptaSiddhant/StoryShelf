import { eq, sql } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { ContentRef } from "../schema/content-ref.ts";
import { col } from "./columns.ts";

/** Content refs for deduplicated Storybook assets. */
export class ContentRefModel {
  private readonly tables: { contentRefs: Table };
  private readonly db: DatabaseAdapter;

  constructor(db: DatabaseAdapter, tables?: { contentRefs: Table }) {
    this.db = db;
    this.tables = tables ?? { contentRefs: db.tables.contentRefs };
  }

  /**
   * The row of `hash`, found by the `hash` column: the table has no `id` column, which the
   * adapters' by-key `get` needs, so that call would throw.
   */
  async get(hash: string): Promise<ContentRef | null> {
    const rows = (await this.db.list(this.tables.contentRefs, {
      where: eq(col(this.tables.contentRefs, "hash"), hash),
      limit: 1,
    })) as unknown as ContentRef[];
    return rows[0] ?? null;
  }

  /** Drop the row of `hash` (raw statement, for the same reason as {@link ContentRefModel.get}). */
  async forget(hash: string): Promise<void> {
    await this.db.all(sql`DELETE FROM content_refs WHERE hash = ${hash}`);
  }

  async upsert(hash: string): Promise<ContentRef> {
    const now = new Date().toISOString();
    const existing = await this.get(hash);
    if (existing) {
      return (await this.db.update(this.tables.contentRefs, hash, {
        refCount: existing.refCount + 1,
        lastSeenAt: now,
      })) as unknown as ContentRef;
    }
    return (await this.db.insert(this.tables.contentRefs, {
      hash,
      refCount: 1,
      lastSeenAt: now,
      createdAt: now,
    })) as unknown as ContentRef;
  }

  async decrement(hash: string): Promise<ContentRef | null> {
    const existing = await this.get(hash);
    if (!existing) return null;
    if (existing.refCount <= 1) {
      await this.db.remove(this.tables.contentRefs, hash);
      return null;
    }
    return (await this.db.update(this.tables.contentRefs, hash, {
      refCount: existing.refCount - 1,
      lastSeenAt: new Date().toISOString(),
    })) as unknown as ContentRef;
  }

  async listStale(cutoff: string): Promise<ContentRef[]> {
    const all = (await this.db.list(this.tables.contentRefs)) as unknown as ContentRef[];
    return all.filter((r) => r.refCount === 0 && r.lastSeenAt < cutoff);
  }
}
