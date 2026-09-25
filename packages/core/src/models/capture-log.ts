/** Capture log lines: every stored line of a capture attempt. */
import { asc, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { CaptureLog, CaptureLogLevel } from "../schema/capture-attempt.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link CaptureLogModel}. */
export interface CaptureLogTables {
  captureLogs: Table;
}

/** Data operations for capture log lines (every line of an attempt). */
export class CaptureLogModel {
  private readonly tables: CaptureLogTables;
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: CaptureLogTables,
  ) {
    this.tables = tables ?? { captureLogs: db.tables.captureLogs };
  }

  async listByAttempt(attemptId: string, limit?: number): Promise<CaptureLog[]> {
    return (await this.db.list(this.tables.captureLogs, {
      where: eq(columnsOf(this.tables.captureLogs, "attemptId"), attemptId),
      orderBy: asc(columnsOf(this.tables.captureLogs, "seq")),
      ...(limit === undefined ? {} : { limit }),
    })) as unknown as CaptureLog[];
  }

  async append(
    projectId: string,
    buildId: string,
    attemptId: string,
    level: CaptureLogLevel,
    message: string,
    fields?: unknown,
  ): Promise<CaptureLog> {
    const seq =
      (await this.db.count(
        this.tables.captureLogs,
        eq(columnsOf(this.tables.captureLogs, "attemptId"), attemptId),
      )) + 1;
    return (await this.db.insert(this.tables.captureLogs, {
      id: ulid(),
      projectId,
      buildId,
      attemptId,
      seq,
      level,
      message,
      fields: fields === undefined ? null : JSON.stringify(fields),
      createdAt: new Date().toISOString(),
    })) as unknown as CaptureLog;
  }
}

function columnsOf(table: Table, column: string): SQLWrapper {
  return getTableColumns(table)[column] as unknown as SQLWrapper;
}
