import type { DatabaseAdapter } from "../db/database.ts";
import type { ContentRef } from "../schema/content-ref.ts";

/** Content refs for deduplicated Storybook assets. */
export class ContentRefModel {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: { contentRefs: unknown },
  ) {}

  async get(hash: string): Promise<ContentRef | null> {
    return (await this.db.get(
      this.tables.contentRefs as never,
      hash,
    )) as unknown as ContentRef | null;
  }

  async upsert(hash: string): Promise<ContentRef> {
    const now = new Date().toISOString();
    const existing = await this.get(hash);
    if (existing) {
      return (await this.db.update(this.tables.contentRefs as never, hash, {
        refCount: existing.refCount + 1,
        lastSeenAt: now,
        updatedAt: now,
      } as never)) as unknown as ContentRef;
    }
    return (await this.db.insert(
      this.tables.contentRefs as never,
      {
        hash,
        refCount: 1,
        lastSeenAt: now,
        createdAt: now,
      } as never,
    )) as unknown as ContentRef;
  }

  async decrement(hash: string): Promise<ContentRef | null> {
    const existing = await this.get(hash);
    if (!existing) return null;
    if (existing.refCount <= 1) {
      await this.db.remove(this.tables.contentRefs as never, hash);
      return null;
    }
    return (await this.db.update(this.tables.contentRefs as never, hash, {
      refCount: existing.refCount - 1,
      lastSeenAt: new Date().toISOString(),
    } as never)) as unknown as ContentRef;
  }

  async listStale(cutoff: string): Promise<ContentRef[]> {
    const all = (await this.db.list(this.tables.contentRefs as never)) as unknown as ContentRef[];
    return all.filter((r) => r.refCount === 0 || new Date(r.lastSeenAt).toISOString() < cutoff);
  }
}
