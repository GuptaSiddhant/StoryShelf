/** Insight rows: pending/running/done/failed runs with dedupe by unique key. */
import { and, asc, desc, eq, getTableColumns, inArray, isNull, lt } from "drizzle-orm";
import type { SQL, SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { InsightKind, InsightRow } from "../schema/insight.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link InsightModel}. */
export interface InsightTables {
  insights: Table;
}

/** Identity and metadata of a run to start. */
export interface InsightStartInput {
  projectId: string;
  buildId: string | null;
  kind: InsightKind;
  windowKey: string | null;
  inputHash: string;
  profile: string;
  model: string;
  promptVersion: string;
  /** Re-run even when a finished row with the same hash exists. */
  force?: boolean;
}

/** Outcome of {@link InsightModel.start}: the row and whether work must run. */
export interface InsightStartResult {
  row: InsightRow;
  /** True when the caller should run inference for this row. */
  run: boolean;
}

/** Result payload stored on success. */
export interface InsightResultInput {
  verdict: string;
  summary: string;
  result: string;
}

/** Data operations for insights. */
export class InsightModel {
  private readonly tables: InsightTables;
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: InsightTables,
  ) {
    this.tables = tables ?? { insights: db.tables.insights };
  }

  /**
   * Insert a `pending` row, or return the existing one for the same unique key
   * (the dedupe: concurrent identical requests share one row). Failed rows,
   * replaced health rows, and `force` restart the existing row in place.
   */
  async start(input: InsightStartInput): Promise<InsightStartResult> {
    const existing = await this.findByKey(input);
    if (existing) {
      return await this.restartIfNeeded(existing, input);
    }
    try {
      const row = (await this.db.insert(this.tables.insights, {
        id: ulid(),
        ...pick(input),
        status: "pending",
        createdAt: new Date().toISOString(),
      })) as unknown as InsightRow;
      return { row, run: true };
    } catch (error) {
      const raced = await this.findByKey(input);
      if (raced) {
        return { row: raced, run: false };
      }
      throw error;
    }
  }

  async get(id: string): Promise<InsightRow | null> {
    return (await this.db.get(this.tables.insights, id)) as unknown as InsightRow | null;
  }

  /** Newest triage rows for a build (any status), newest first. */
  async listForBuild(buildId: string, limit = 20): Promise<InsightRow[]> {
    return (await this.db.list(this.tables.insights, {
      where: and(eq(this.col("buildId"), buildId), eq(this.col("kind"), "triage")),
      orderBy: desc(this.col("createdAt")),
      limit,
    })) as unknown as InsightRow[];
  }

  /** The health row for a project window, if any. */
  async getHealth(projectId: string, windowKey: string): Promise<InsightRow | null> {
    const rows = (await this.db.list(this.tables.insights, {
      where: and(
        eq(this.col("projectId"), projectId),
        eq(this.col("kind"), "health"),
        eq(this.col("windowKey"), windowKey),
      ),
      limit: 1,
    })) as unknown as InsightRow[];
    return rows[0] ?? null;
  }

  async markRunning(id: string): Promise<void> {
    await this.db.update(this.tables.insights, id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
  }

  async markDone(id: string, result: InsightResultInput): Promise<void> {
    await this.db.update(this.tables.insights, id, {
      status: "done",
      ...result,
      errorCode: null,
      finishedAt: new Date().toISOString(),
    });
  }

  async markFailed(id: string, errorCode: string): Promise<void> {
    await this.db.update(this.tables.insights, id, {
      status: "failed",
      errorCode,
      finishedAt: new Date().toISOString(),
    });
  }

  /** Explicitly remove all rows of a build (no reliance on FK cascade). */
  async removeForBuild(buildId: string): Promise<number> {
    return await this.removeWhere(eq(this.col("buildId"), buildId));
  }

  /** Remove health rows created before `cutoffIso`. */
  async purgeHealthBefore(cutoffIso: string): Promise<number> {
    const where = and(eq(this.col("kind"), "health"), lt(this.col("createdAt"), cutoffIso));
    return where ? await this.removeWhere(where) : 0;
  }

  /** Mark pending/running rows older than `cutoffIso` as interrupted. */
  async sweepStale(cutoffIso: string): Promise<number> {
    const stale = (await this.db.list(this.tables.insights, {
      where: and(
        inArray(this.col("status"), ["pending", "running"]),
        lt(this.col("createdAt"), cutoffIso),
      ),
    })) as unknown as InsightRow[];
    await Promise.all(
      stale.map(async (row) => {
        await this.markFailed(row.id, "interrupted");
      }),
    );
    return stale.length;
  }

  private async removeWhere(where: SQL): Promise<number> {
    const rows = (await this.db.list(this.tables.insights, {
      where,
      orderBy: asc(this.col("id")),
    })) as unknown as InsightRow[];
    await Promise.all(
      rows.map(async (row) => {
        await this.db.remove(this.tables.insights, row.id);
      }),
    );
    return rows.length;
  }

  private async findByKey(input: InsightStartInput): Promise<InsightRow | null> {
    const where =
      input.kind === "health"
        ? and(
            eq(this.col("projectId"), input.projectId),
            eq(this.col("kind"), "health"),
            input.windowKey === null
              ? isNull(this.col("windowKey"))
              : eq(this.col("windowKey"), input.windowKey),
          )
        : and(
            eq(this.col("projectId"), input.projectId),
            input.buildId === null
              ? isNull(this.col("buildId"))
              : eq(this.col("buildId"), input.buildId),
            eq(this.col("kind"), input.kind),
            eq(this.col("inputHash"), input.inputHash),
          );
    const rows = (await this.db.list(this.tables.insights, {
      where,
      limit: 1,
    })) as unknown as InsightRow[];
    return rows[0] ?? null;
  }

  private async restartIfNeeded(
    existing: InsightRow,
    input: InsightStartInput,
  ): Promise<InsightStartResult> {
    const inFlight = existing.status === "pending" || existing.status === "running";
    const sameHash = existing.inputHash === input.inputHash;
    if (inFlight || (existing.status === "done" && sameHash && !input.force)) {
      return { row: existing, run: false };
    }
    const row = (await this.db.update(this.tables.insights, existing.id, {
      ...pick(input),
      status: "pending",
      verdict: null,
      summary: null,
      result: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date().toISOString(),
    })) as unknown as InsightRow;
    return { row, run: true };
  }

  private col(name: string): SQLWrapper {
    return getTableColumns(this.tables.insights)[name] as unknown as SQLWrapper;
  }
}

function pick(input: InsightStartInput): Record<string, unknown> {
  return {
    projectId: input.projectId,
    buildId: input.buildId,
    kind: input.kind,
    windowKey: input.windowKey,
    inputHash: input.inputHash,
    profile: input.profile,
    model: input.model,
    promptVersion: input.promptVersion,
  };
}
