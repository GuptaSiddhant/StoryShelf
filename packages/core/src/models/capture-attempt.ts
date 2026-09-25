/** Capture attempts and their log lines: per-run history for a build. */
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { Logger } from "pino";
import type { JobStatus } from "../adapters/capture-queue.ts";
import type { DatabaseAdapter } from "../db/database.ts";
import type { CaptureAttempt, CaptureLogLevel } from "../schema/capture-attempt.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link CaptureAttemptModel}. */
export interface CaptureAttemptTables {
  captureAttempts: Table;
}

/** Data operations for capture attempts (one row per build run). */
export class CaptureAttemptModel {
  private readonly tables: CaptureAttemptTables;
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: CaptureAttemptTables,
  ) {
    this.tables = tables ?? { captureAttempts: db.tables.captureAttempts };
  }

  async listByBuild(buildId: string): Promise<CaptureAttempt[]> {
    return (await this.db.list(this.tables.captureAttempts, {
      where: eq(columnsOf(this.tables.captureAttempts, "buildId"), buildId),
      orderBy: asc(columnsOf(this.tables.captureAttempts, "attemptNo")),
    })) as unknown as CaptureAttempt[];
  }

  async getByNo(buildId: string, attemptNo: number): Promise<CaptureAttempt | null> {
    const rows = (await this.db.list(this.tables.captureAttempts, {
      where: and(
        eq(columnsOf(this.tables.captureAttempts, "buildId"), buildId),
        eq(columnsOf(this.tables.captureAttempts, "attemptNo"), attemptNo),
      ),
    })) as unknown as CaptureAttempt[];
    return rows[0] ?? null;
  }

  async startAttempt(projectId: string, buildId: string, reqId?: string): Promise<CaptureAttempt> {
    const existing = await this.listByBuild(buildId);
    let attemptNo = 1;
    for (const row of existing) {
      if (row.attemptNo >= attemptNo) {
        attemptNo = row.attemptNo + 1;
      }
    }
    const now = new Date().toISOString();
    return (await this.db.insert(this.tables.captureAttempts, {
      id: ulid(),
      projectId,
      buildId,
      attemptNo,
      status: "queued",
      error: null,
      reqId: reqId ?? null,
      storyCount: 0,
      failedCount: 0,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })) as unknown as CaptureAttempt;
  }

  async markRunning(id: string): Promise<CaptureAttempt> {
    const now = new Date().toISOString();
    return (await this.db.update(this.tables.captureAttempts, id, {
      status: "running",
      startedAt: now,
      updatedAt: now,
    })) as unknown as CaptureAttempt;
  }

  async markFinished(
    id: string,
    status: Extract<JobStatus, "completed" | "failed" | "cancelled">,
    error?: string,
    counts?: { storyCount: number; failedCount: number },
  ): Promise<CaptureAttempt> {
    const now = new Date().toISOString();
    return (await this.db.update(this.tables.captureAttempts, id, {
      status,
      error: error ?? null,
      storyCount: counts?.storyCount ?? 0,
      failedCount: counts?.failedCount ?? 0,
      finishedAt: now,
      updatedAt: now,
    })) as unknown as CaptureAttempt;
  }
}

function columnsOf(table: Table, column: string): SQLWrapper {
  return getTableColumns(table)[column] as unknown as SQLWrapper;
}

/**
 * Recorder writing one attempt log line to the `capture_logs` table.
 * Dispatch builds it per attempt; the orchestrator and pipeline call it
 * alongside every pino log so the UI can replay the run later.
 */
export type AttemptLogRecorder = (
  level: CaptureLogLevel,
  message: string,
  fields?: unknown,
) => Promise<void>;

/**
 * Record one attempt log line without breaking the capture on write failure.
 * Log-write failures are reported through pino and never thrown.
 */
export async function emitAttemptLog(
  record: AttemptLogRecorder | undefined,
  logger: Logger | undefined,
  level: CaptureLogLevel,
  message: string,
  fields?: unknown,
): Promise<void> {
  if (!record) {
    return;
  }
  try {
    await record(level, message, fields);
  } catch (error) {
    logger?.warn({ err: error }, "attempt log write failed");
  }
}
