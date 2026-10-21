/** Rows of the database queue (`capture_jobs`): job rows, per-attempt claim rows, and their views. */
import { and, asc, desc, eq, inArray, lt, lte } from "drizzle-orm";
import type { Column, SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type {
  CaptureAttemptStatus,
  CaptureJobKind,
  CaptureJobRow,
  CaptureJobStatus,
} from "../schema/capture-job.ts";
import { col } from "./columns.ts";

/** Tables required by {@link CaptureJobModel}. */
export interface CaptureJobTables {
  captureJobs: Table;
}

/** A job to put on the queue. */
export interface NewCaptureJob {
  id: string;
  kind: CaptureJobKind;
  buildId?: string | null;
  shardId?: string | null;
  maxAttempts: number;
  /** JSON payload (request id, traceparent, kind-specific fields). */
  payload?: string | null;
  /** When the job may first be claimed; defaults to `now`. */
  visibleAt?: string;
}

/** The claim an instance makes on a job: attempt `attempt`, held by `owner` until `leaseUntil`. */
export interface AttemptClaim {
  job: CaptureJobRow;
  attempt: number;
  owner: string;
  leaseUntil: string;
}

/** Job statuses that end a job: nothing claims it again. */
export const TERMINAL_JOB_STATUSES: readonly CaptureJobStatus[] = ["done", "failed", "cancelled"];

/** Statuses of rows the poll may claim: a queued job, or a running attempt whose lease ran out. */
const CANDIDATE_STATUSES = ["queued", "running"];

/**
 * Data operations of the database queue. Every write is an unconditional update by id or an
 * insert; the only atomic primitive is the unique-key insert of an attempt row ({@link claim}),
 * which is what fences concurrent claimers on every supported database.
 */
export class CaptureJobModel {
  readonly #db: DatabaseAdapter;
  readonly #table: Table;
  readonly #c: JobColumns;

  constructor(db: DatabaseAdapter, tables?: CaptureJobTables) {
    this.#db = db;
    this.#table = (tables ?? { captureJobs: db.tables.captureJobs }).captureJobs;
    this.#c = jobColumns(this.#table);
  }

  async get(id: string): Promise<CaptureJobRow | null> {
    return (await this.#db.get(this.#table, id)) as unknown as CaptureJobRow | null;
  }

  /** Insert a queued job row. */
  async create(input: NewCaptureJob, now: string): Promise<CaptureJobRow> {
    return (await this.#db.insert(this.#table, jobRow(input, now))) as unknown as CaptureJobRow;
  }

  /**
   * The poll probe: the oldest row of `kinds` that may be claimed at `now`. One indexed range query
   * on `(kind, visible_at, status)`, limit 1; only candidates have a `visibleAt`, so an empty queue
   * reads no rows and a busy one reads one.
   */
  async nextCandidate(
    kinds: readonly CaptureJobKind[],
    now: string,
  ): Promise<CaptureJobRow | null> {
    const rows = (await this.#db.list(this.#table, {
      where: and(
        kindFilter(this.#c, kinds),
        lte(this.#c.visibleAt, now),
        inArray(this.#c.status, CANDIDATE_STATUSES),
      ),
      orderBy: asc(this.#c.visibleAt),
      limit: 1,
    })) as unknown as CaptureJobRow[];
    return rows[0] ?? null;
  }

  /**
   * Claim attempt `attempt` of a job by inserting its row `<jobId>:<attempt>`. Exactly one caller
   * succeeds on every database; the others hit the primary key, which this reports as `false`
   * (told apart from real failures by re-reading the row, as `CaptureShardModel.claimFinalize`).
   */
  async claim(input: AttemptClaim, now: string): Promise<boolean> {
    const id = attemptRowId(input.job.jobId, input.attempt);
    try {
      await this.#db.insert(this.#table, attemptRow(input, now));
      return true;
    } catch (error) {
      if ((await this.get(id)) === null) {
        throw error;
      }
      return false;
    }
  }

  /** The claim won: the job row records the running attempt and leaves the poll's index range. */
  async markRunning(jobId: string, attempt: number, now: string): Promise<void> {
    await this.#db.update(this.#table, jobId, {
      status: "running",
      attempt,
      visibleAt: null,
      startedAt: now,
      updatedAt: now,
    });
  }

  /** Push an attempt's lease out. Returns the row (null if gone) so the caller sees cancel or expiry. */
  async renew(attemptId: string, leaseUntil: string, now: string): Promise<CaptureJobRow | null> {
    const row = await this.#db.update(this.#table, attemptId, {
      visibleAt: leaseUntil,
      updatedAt: now,
    });
    return (row ?? null) as unknown as CaptureJobRow | null;
  }

  /** The attempt row `attemptId` if it is running with a lease that passed by `now`, else null. */
  async expiredAttempt(attemptId: string, now: string): Promise<CaptureJobRow | null> {
    const rows = (await this.#db.list(this.#table, {
      where: and(
        eq(this.#c.id, attemptId),
        eq(this.#c.status, "running"),
        lte(this.#c.visibleAt, now),
      ),
      limit: 1,
    })) as unknown as CaptureJobRow[];
    return rows[0] ?? null;
  }

  /** Move a row's visibility time (and nothing else). */
  async defer(id: string, visibleAt: string, now: string): Promise<void> {
    await this.#db.update(this.#table, id, { visibleAt, updatedAt: now });
  }

  /** Take a row out of the poll's index range without changing its status. */
  async clearVisibility(id: string, now: string): Promise<void> {
    await this.#db.update(this.#table, id, { visibleAt: null, updatedAt: now });
  }

  /** End an attempt row: `done`, `failed` (with its error) or `expired` (taken over). */
  async finishAttempt(
    attemptId: string,
    status: Exclude<CaptureAttemptStatus, "running">,
    now: string,
    error: string | null = null,
  ): Promise<void> {
    await this.#db.update(this.#table, attemptId, {
      status,
      visibleAt: null,
      error,
      finishedAt: now,
      updatedAt: now,
    });
  }

  /** End a job row for good. */
  async finishJob(
    jobId: string,
    status: Exclude<CaptureJobStatus, "queued" | "running">,
    now: string,
    error: string | null = null,
  ): Promise<void> {
    const patch = { status, visibleAt: null, finishedAt: now, updatedAt: now };
    await this.#db.update(this.#table, jobId, error === null ? patch : { ...patch, error });
  }

  /** Put a job back on the queue, claimable from `visibleAt`, remembering why the attempt failed. */
  async requeue(
    jobId: string,
    visibleAt: string,
    error: string | null,
    now: string,
  ): Promise<void> {
    await this.#db.update(this.#table, jobId, {
      status: "queued",
      visibleAt,
      error,
      updatedAt: now,
    });
  }

  /** Flag a row as cancel-requested; the flag is never cleared. */
  async flagCancel(id: string, now: string): Promise<void> {
    await this.#db.update(this.#table, id, { cancelRequestedAt: now, updatedAt: now });
  }

  /** Job rows of a build (its own job and its shard jobs), oldest first. */
  async listForBuild(buildId: string): Promise<CaptureJobRow[]> {
    const rows = (await this.#db.list(this.#table, {
      where: and(eq(this.#c.buildId, buildId), jobEntries(this.#c)),
    })) as unknown as CaptureJobRow[];
    return rows.toSorted(byCreation);
  }

  /** The build's own (non-shard) job of `kinds` most recently queued, or null. */
  async latestForBuild(
    buildId: string,
    kinds: readonly CaptureJobKind[],
  ): Promise<CaptureJobRow | null> {
    const own = (await this.listForBuild(buildId)).filter(
      (row) => row.shardId === null && kinds.includes(row.kind),
    );
    return own.at(-1) ?? null;
  }

  /** Attempt rows of a job, by attempt number. */
  async attempts(jobId: string): Promise<CaptureJobRow[]> {
    const rows = (await this.#db.list(this.#table, {
      where: and(eq(this.#c.jobId, jobId), eq(this.#c.entry, "attempt")),
    })) as unknown as CaptureJobRow[];
    return rows.toSorted((a, b) => a.attempt - b.attempt);
  }

  /** Job rows of `kinds` that are queued or running, oldest first. */
  async listActive(kinds: readonly CaptureJobKind[]): Promise<CaptureJobRow[]> {
    const rows = (await this.#db.list(this.#table, {
      where: and(
        jobEntries(this.#c),
        kindFilter(this.#c, kinds),
        inArray(this.#c.status, CANDIDATE_STATUSES),
      ),
    })) as unknown as CaptureJobRow[];
    return rows.toSorted(byCreation);
  }

  /** The newest job rows of `kinds`, newest first. */
  async listRecent(kinds: readonly CaptureJobKind[], limit: number): Promise<CaptureJobRow[]> {
    const rows = (await this.#db.list(this.#table, {
      where: and(jobEntries(this.#c), kindFilter(this.#c, kinds)),
      orderBy: desc(this.#c.createdAt),
      limit,
    })) as unknown as CaptureJobRow[];
    return rows.toSorted((a, b) => byCreation(b, a));
  }

  /**
   * Retention: delete finished jobs created before `before`, with their attempt rows. Returns the
   * number of jobs removed. Running and queued jobs are never touched.
   */
  async purgeFinished(before: string): Promise<number> {
    const rows = (await this.#db.list(this.#table, {
      where: and(
        jobEntries(this.#c),
        lt(this.#c.createdAt, before),
        inArray(this.#c.status, [...TERMINAL_JOB_STATUSES]),
      ),
    })) as unknown as CaptureJobRow[];
    await Promise.all(
      rows.map(async (row) => {
        await this.#removeJob(row.id);
      }),
    );
    return rows.length;
  }

  async #removeJob(jobId: string): Promise<void> {
    const attempts = await this.attempts(jobId);
    await Promise.all(
      attempts.map(async (row) => {
        await this.#db.remove(this.#table, row.id);
      }),
    );
    await this.#db.remove(this.#table, jobId);
  }
}

/** Primary key of attempt `attempt` of a job. */
export function attemptRowId(jobId: string, attempt: number): string {
  return `${jobId}:${String(attempt)}`;
}

/** Split an attempt row id back into its job id and number; null when it is not one. */
export function parseAttemptRowId(id: string): { jobId: string; attempt: number } | null {
  const cut = id.lastIndexOf(":");
  const attempt = Number(id.slice(cut + 1));
  if (cut <= 0 || !Number.isInteger(attempt) || attempt < 1) {
    return null;
  }
  return { jobId: id.slice(0, cut), attempt };
}

/** Whether a job row has ended. */
export function isTerminalJob(row: CaptureJobRow): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(row.status);
}

/** Column handles the queries filter and order on. */
interface JobColumns {
  id: Column;
  entry: Column;
  jobId: Column;
  kind: Column;
  buildId: Column;
  status: Column;
  visibleAt: Column;
  createdAt: Column;
}

function jobColumns(table: Table): JobColumns {
  return {
    id: col(table, "id"),
    entry: col(table, "entry"),
    jobId: col(table, "jobId"),
    kind: col(table, "kind"),
    buildId: col(table, "buildId"),
    status: col(table, "status"),
    visibleAt: col(table, "visibleAt"),
    createdAt: col(table, "createdAt"),
  };
}

function kindFilter(c: JobColumns, kinds: readonly CaptureJobKind[]): SQL {
  return kinds.length === 1 ? eq(c.kind, kinds[0]) : inArray(c.kind, [...kinds]);
}

function jobEntries(c: JobColumns): SQL {
  return eq(c.entry, "job");
}

function byCreation(a: CaptureJobRow, b: CaptureJobRow): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function jobRow(input: NewCaptureJob, now: string): CaptureJobRow {
  return {
    ...blankRow(now),
    id: input.id,
    entry: "job",
    jobId: input.id,
    kind: input.kind,
    buildId: input.buildId ?? null,
    shardId: input.shardId ?? null,
    maxAttempts: input.maxAttempts,
    status: "queued",
    visibleAt: input.visibleAt ?? now,
    payload: input.payload ?? null,
  };
}

function attemptRow(input: AttemptClaim, now: string): CaptureJobRow {
  const { job } = input;
  return {
    ...blankRow(now),
    id: attemptRowId(job.jobId, input.attempt),
    entry: "attempt",
    jobId: job.jobId,
    kind: job.kind,
    buildId: job.buildId,
    shardId: job.shardId,
    attempt: input.attempt,
    maxAttempts: job.maxAttempts,
    status: "running",
    visibleAt: input.leaseUntil,
    owner: input.owner,
    cancelRequestedAt: job.cancelRequestedAt,
    startedAt: now,
  };
}

type BlankRow = Omit<CaptureJobRow, "id" | "entry" | "jobId" | "kind" | "status" | "maxAttempts">;

function blankRow(now: string): BlankRow {
  return {
    buildId: null,
    shardId: null,
    attempt: 0,
    visibleAt: null,
    owner: null,
    payload: null,
    cancelRequestedAt: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
