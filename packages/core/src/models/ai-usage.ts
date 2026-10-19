/** Provider-reported AI usage rows; budget and hourly limits are counted from them. */
import { and, asc, eq, getTableColumns, gte, lt } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { AiUsageRow } from "../schema/insight.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link AiUsageModel}. */
export interface AiUsageTables {
  aiUsage: Table;
}

/** Input for recording one provider call. */
export interface AiUsageInput {
  insightId: string | null;
  projectId: string;
  profile: string;
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  images: number;
  status: "ok" | "failed";
}

const PAGE = 500;

/** Data operations for AI usage rows. */
export class AiUsageModel {
  private readonly tables: AiUsageTables;
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: AiUsageTables,
  ) {
    this.tables = tables ?? { aiUsage: db.tables.aiUsage };
  }

  async record(input: AiUsageInput): Promise<AiUsageRow> {
    return (await this.db.insert(this.tables.aiUsage, {
      id: ulid(),
      ...input,
      createdAt: new Date().toISOString(),
    })) as unknown as AiUsageRow;
  }

  /** Page through rows since `sinceIso` (bounded pages; the list clamp is 1000). */
  async listSince(sinceIso: string): Promise<AiUsageRow[]> {
    const all: AiUsageRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      // Pages are inherently sequential (each needs the previous offset).
      // oxlint-disable-next-line no-await-in-loop
      const page = (await this.db.list(this.tables.aiUsage, {
        where: gte(this.col("createdAt"), sinceIso),
        orderBy: asc(this.col("id")),
        limit: PAGE,
        offset,
      })) as unknown as AiUsageRow[];
      all.push(...page);
      if (page.length < PAGE) {
        return all;
      }
    }
  }

  /** Calls recorded for a project since `sinceIso` (rolling-hour limit). */
  async countCalls(projectId: string, sinceIso: string): Promise<number> {
    return await this.db.count(
      this.tables.aiUsage,
      and(eq(this.col("projectId"), projectId), gte(this.col("createdAt"), sinceIso)),
    );
  }

  /** Delete rows older than `cutoffIso`; returns the number removed. */
  async purgeBefore(cutoffIso: string): Promise<number> {
    const rows = (await this.db.list(this.tables.aiUsage, {
      where: lt(this.col("createdAt"), cutoffIso),
      limit: 1000,
    })) as unknown as AiUsageRow[];
    await Promise.all(
      rows.map(async (row) => {
        await this.db.remove(this.tables.aiUsage, row.id);
      }),
    );
    return rows.length;
  }

  private col(name: string): SQLWrapper {
    return getTableColumns(this.tables.aiUsage)[name] as unknown as SQLWrapper;
  }
}
