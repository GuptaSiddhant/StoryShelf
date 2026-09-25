import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { ContentRef } from "../schema/content-ref.ts";

/** Content refs for deduplicated Storybook assets. */
export class ContentRefModel {
  private readonly tables: { contentRefs: Table };
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: { contentRefs: Table },
  ) {
    this.tables = tables ?? { contentRefs: db.tables.contentRefs };
  }

  async get(hash: string): Promise<ContentRef | null> {
    return (await this.db.get(this.tables.contentRefs, hash)) as unknown as ContentRef | null;
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
