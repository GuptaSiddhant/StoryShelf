/** Provider-reported AI usage rows; budget and hourly limits are counted from them. */
import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { AiUsageRow } from "../schema/insight.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

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

/** What a reservation records before the provider answers: a call, with no tokens yet. */
export interface AiUsageReservation {
  projectId: string;
  profile: string;
  task: string;
  model: string;
}

/** The rolling window a reservation is counted in. */
export interface AiCallWindow {
  /** ISO time the window starts at. */
  since: string;
  /** Calls the window allows, reservations included. */
  max: number;
}

const PAGE = 500;

/** Reservations in one process queue up, so the count and the insert never interleave. */
let reserving: Promise<unknown> = Promise.resolve();

/** Data operations for AI usage rows. */
export class AiUsageModel {
  private readonly tables: AiUsageTables;
  private readonly db: DatabaseAdapter;

  constructor(db: DatabaseAdapter, tables?: AiUsageTables) {
    this.db = db;
    this.tables = tables ?? { aiUsage: db.tables.aiUsage };
  }

  async record(input: AiUsageInput): Promise<AiUsageRow> {
    return (await this.db.insert(this.tables.aiUsage, {
      id: ulid(),
      ...input,
      createdAt: new Date().toISOString(),
    })) as unknown as AiUsageRow;
  }

  /**
   * Reserve one call of a project's window before calling the provider: a `pending` row with no
   * tokens, counted as a call, or `null` when the window is full. Concurrent requests cannot all
   * pass a check and overshoot the limit: reservations queue within a process, and after the
   * insert the row's rank among the window's rows (by id) must still be within the limit, which
   * covers another instance inserting at the same moment (a loser removes its own row).
   */
  async reserve(input: AiUsageReservation, window: AiCallWindow): Promise<AiUsageRow | null> {
    const turn = reserving.then(async () => await this.reserveNow(input, window));
    reserving = turn.catch(() => null);
    return await turn;
  }

  private async reserveNow(
    input: AiUsageReservation,
    window: AiCallWindow,
  ): Promise<AiUsageRow | null> {
    if ((await this.countCalls(input.projectId, window.since)) >= window.max) {
      return null;
    }
    const row = (await this.db.insert(this.tables.aiUsage, {
      id: ulid(),
      insightId: null,
      ...input,
      inputTokens: 0,
      outputTokens: 0,
      estimated: false,
      images: 0,
      status: "pending",
      createdAt: new Date().toISOString(),
    })) as unknown as AiUsageRow;
    const rank = await this.db.count(
      this.tables.aiUsage,
      and(
        eq(this.col("projectId"), input.projectId),
        gte(this.col("createdAt"), window.since),
        lte(this.col("id"), row.id),
      ),
    );
    if (rank > window.max) {
      await this.db.remove(this.tables.aiUsage, row.id);
      return null;
    }
    return row;
  }

  /** Tie a reservation to the insight it is for. */
  async attach(reservationId: string, insightId: string): Promise<void> {
    await this.db.update(this.tables.aiUsage, reservationId, { insightId });
  }

  /** Give a reservation back (no call was made). */
  async release(reservationId: string): Promise<void> {
    await this.db.remove(this.tables.aiUsage, reservationId);
  }

  /**
   * Fill in the pending reservation of an insight with what the provider reported. Returns false
   * when the insight has none (the row is then recorded the ordinary way).
   */
  async complete(insightId: string, input: AiUsageInput): Promise<boolean> {
    const pending = await this.pendingFor(insightId);
    if (!pending) {
      return false;
    }
    await this.db.update(this.tables.aiUsage, pending.id, { ...input });
    return true;
  }

  /** Keep an insight's reservation as a failed call with no tokens (the provider gave no usage). */
  async settleFailed(insightId: string): Promise<void> {
    const pending = await this.pendingFor(insightId);
    if (pending) {
      await this.db.update(this.tables.aiUsage, pending.id, { status: "failed" });
    }
  }

  private async pendingFor(insightId: string): Promise<AiUsageRow | undefined> {
    const rows = (await this.db.list(this.tables.aiUsage, {
      where: and(eq(this.col("insightId"), insightId), eq(this.col("status"), "pending")),
      limit: 1,
    })) as unknown as AiUsageRow[];
    return rows[0];
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
    return col(this.tables.aiUsage, name);
  }
}
