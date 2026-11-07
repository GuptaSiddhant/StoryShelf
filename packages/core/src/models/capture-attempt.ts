import { and, asc, eq, inArray } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { Logger } from "pino";
import type { JobStatus } from "../adapters/capture-queue.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { CaptureAttempt, CaptureLogLevel } from "../schema/capture-attempt.ts";
/** Capture attempts and their log lines: per-run history for a build. */
import { JobAbortedError } from "../utils/job-aborted.ts";
import { redactSecrets } from "../utils/redact.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link CaptureAttemptModel}. */
export interface CaptureAttemptTables {
  captureAttempts: Table;
}

/** Data operations for capture attempts (one row per build run). */
export class CaptureAttemptModel {
  private readonly tables: CaptureAttemptTables;
  private readonly db: DatabaseAdapter;

  constructor(db: DatabaseAdapter, tables?: CaptureAttemptTables) {
    this.db = db;
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
    const settled = await this.#cancelled(id);
    if (settled) {
      return settled;
    }
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
    const settled = status === "cancelled" ? null : await this.#cancelled(id);
    if (settled) {
      return settled;
    }
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

  /**
   * Close an attempt only while it is still `queued` or `running`, in one conditional write, so a
   * close that raced ahead (a completed run, a cancel) is never overwritten. Resolves to the closed
   * row, or null when the attempt was not open any more (or does not exist).
   */
  async closeIfOpen(
    id: string,
    status: Extract<JobStatus, "completed" | "failed" | "cancelled">,
    error: string | undefined,
    counts: { storyCount: number; failedCount: number },
  ): Promise<CaptureAttempt | null> {
    const table = this.tables.captureAttempts;
    const stamp = nextStamp();
    const row = (await this.db.updateWhere(
      table,
      id,
      {
        status,
        error: error ?? null,
        storyCount: counts.storyCount,
        failedCount: counts.failedCount,
        finishedAt: stamp,
        updatedAt: stamp,
      },
      inArray(columnsOf(table, "status"), ["queued", "running"]),
    )) as unknown as CaptureAttempt | null;
    // `updateWhere` returns the row whether or not the write applied; only ours carries our stamp,
    // compared as instants because Postgres hands the column back in its own text form.
    const written =
      typeof row?.finishedAt === "string" && instantOf(row.finishedAt) === instantOf(stamp);
    return row !== null && written && row.status === status ? row : null;
  }

  /**
   * The attempt row when a cancel already closed it (ADR 0006): a run that ends after a user
   * cancelled the build must not rewrite the row as `completed` or `failed`. Null otherwise.
   */
  async #cancelled(id: string): Promise<CaptureAttempt | null> {
    const row = (await this.db.get(
      this.tables.captureAttempts,
      id,
    )) as unknown as CaptureAttempt | null;
    return row?.status === "cancelled" ? row : null;
  }

  /**
   * Close every attempt of a build still `queued` or `running` other than `keepId`, as `cancelled`
   * with `reason`: a new plan of the build supersedes them, and nothing else would ever close them.
   */
  async closeOthers(buildId: string, keepId: string | null, reason: string): Promise<number> {
    const open = (await this.listByBuild(buildId)).filter(
      (row) => row.id !== keepId && (row.status === "queued" || row.status === "running"),
    );
    await Promise.all(
      open.map(async (row) => {
        await this.markFinished(row.id, "cancelled", reason);
      }),
    );
    return open.length;
  }
}

function columnsOf(table: Table, column: string): SQLWrapper {
  return col(table, column);
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
 * Log-write failures are reported through pino and never thrown; a {@link JobAbortedError} from
 * the recorder (the attempt was abandoned) is rethrown.
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
    await record(level, redactSecrets(message), fields);
  } catch (error) {
    // An abandoned attempt must stop, not log a warning and carry on.
    if (error instanceof JobAbortedError) {
      throw error;
    }
    logger?.warn({ err: error }, "attempt log write failed");
  }
}

/** The last stamp handed out by {@link nextStamp}; it only ever moves forward. */
let lastStamp = 0;

/** An ISO timestamp strictly later than the previous one this process handed out. */
function nextStamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

/** The instant a stored timestamp names, whichever text form the driver returns. */
function instantOf(value: string): number {
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  // `2026-11-03 19:46:04.101+00` (Postgres) is not ISO: make it so, for runtimes that do not guess.
  return Date.parse(value.replace(" ", "T").replace(/(?<hours>[+-]\d{2})$/u, "$<hours>:00"));
}
