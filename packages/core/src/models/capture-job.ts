/** Rows of the database queue (`capture_jobs`): job rows, per-attempt claim rows, and their views. */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte } from "drizzle-orm";
import type { Column, SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter, TxStore } from "../adapters/database.ts";
import type {
  CaptureAttemptStatus,
  CaptureJobKind,
  CaptureJobRow,
  CaptureJobStatus,
} from "../schema/capture-job.ts";
import { ulid } from "../utils/ulid.ts";
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
  /** Single-flight key: at most one non-terminal job may hold it (a unique column). */
  activeKey?: string | null;
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

/** Inserts {@link CaptureJobModel.createKeyed} tries while the key keeps changing hands. */
const KEYED_INSERT_TRIES = 3;

/** Statuses of rows the poll may claim: a queued job, or a running attempt whose lease ran out. */
const CANDIDATE_STATUSES = ["queued", "running"];

/** Statuses of unfinished jobs the queue views list: candidates plus a job running its exhausted-job hook. */
const ACTIVE_STATUSES = [...CANDIDATE_STATUSES, "exhausting"];

/**
 * Data operations of the database queue. Writes are unconditional updates by id or inserts; the
 * atomic primitives are the unique-key insert of an attempt row ({@link claim}), which fences
 * concurrent claimers, and the unique `active_key` of a single-flight job ({@link createKeyed}),
 * which fences concurrent enqueues, on every supported database.
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
   * Insert a queued job that holds `activeKey`, or report the job that already holds it. The
   * database decides: a second insert for the same key hits the unique index, and the row that
   * holds it is read back (a failure with no holder behind it is a real one and is rethrown, as
   * in {@link claim}). The holder can end between the failed insert and the read; the key is then
   * free again, so the insert is tried again, a few times at most.
   */
  async createKeyed(
    input: NewCaptureJob & { activeKey: string },
    now: string,
  ): Promise<{ created: CaptureJobRow } | { holder: CaptureJobRow }> {
    let failure: unknown;
    for (let attempt = 0; attempt < KEYED_INSERT_TRIES; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each try depends on the last one's outcome
        return { created: await this.create(input, now) };
      } catch (error) {
        failure = error;
        // oxlint-disable-next-line no-await-in-loop -- read back what the failed insert collided with
        const holder = await this.holderOf(input.activeKey);
        if (holder !== null) {
          return { holder };
        }
      }
    }
    throw failure;
  }

  /** The non-terminal job row that holds `activeKey`, or null. */
  async holderOf(activeKey: string): Promise<CaptureJobRow | null> {
    const rows = (await this.#db.list(this.#table, {
      where: eq(this.#c.activeKey, activeKey),
      limit: 1,
    })) as unknown as CaptureJobRow[];
    return rows[0] ?? null;
  }

  /**
   * A request arrived for the key of the running job `jobId`: record that one more pass is owed.
   * One conditional write, applied only while the job is `running` or `exhausting`. Returns the row
   * as it stands, so the caller can tell whether the request is now covered (unfinished with the
   * marker set, or `queued`) or the job ended and the request must become a new job.
   */
  async requestRerun(jobId: string, now: string): Promise<CaptureJobRow | null> {
    return (await this.#db.updateWhere(
      this.#table,
      jobId,
      { rerunRequestedAt: now, updatedAt: now },
      // An `exhausting` job is still unfinished and its final settle hands over, like a running one.
      allOf(inArray(this.#c.status, ["running", "exhausting"]), isNull(this.#c.rerunRequestedAt)),
    )) as unknown as CaptureJobRow | null;
  }

  /**
   * Take the rerun request of the ended job `jobId`: one conditional write clears the marker, and
   * only the writer whose write cleared it gets `true`, so of several settlers reaching the same
   * ended job exactly one starts the successor. The writer is told apart by the unique `stamp` it
   * leaves in `updatedAt`; a refused write leaves the winner's stamp there. `after` is the
   * `updatedAt` the caller read, which the stamp must pass.
   */
  async takeRerun(jobId: string, after: string): Promise<boolean> {
    const stamp = uniqueStamp(after);
    const row = (await this.#db.updateWhere(
      this.#table,
      jobId,
      { rerunRequestedAt: null, updatedAt: stamp },
      isNotNull(this.#c.rerunRequestedAt),
    )) as unknown as CaptureJobRow | null;
    return row?.rerunRequestedAt === null && sameInstant(row.updatedAt, stamp);
  }

  /**
   * End the job `jobId` and hand its key over in one transaction, so a crash leaves either the job
   * still unfinished (its lease expires and it is redelivered) or its successor queued, never a job
   * that ended with a request owed and no successor. The terminal write comes first: it takes the
   * row, so a concurrent settler of the same job or a concurrent request for its key waits for this
   * commit and then sees the job ended with the marker already taken. If the marker is set and the
   * job `failed` or is `done`, it is cleared and a successor with the same key and payload is
   * inserted in the same transaction; a throw anywhere (the insert included) rolls the end back.
   *
   * `onlyOpen` leaves a job that already ended as it is (a late `done` or a cancel keeps its
   * outcome), as {@link finishOpenJob} does. Resolves to `null` when the database has no
   * transactions, or only sequential ones (`metadata.transactions`): the caller then ends the job
   * and starts the successor in two steps (a crash between them loses the request).
   */
  async endJob(
    jobId: string,
    end: {
      status: Exclude<CaptureJobStatus, "queued" | "running" | "exhausting">;
      error?: string | null;
      onlyOpen?: boolean;
      /**
       * The attempt that ran the job, ended in the same transaction: its lease goes with the end,
       * so a rollback leaves it running and the job is redelivered when the lease runs out.
       */
      attempt?: { id: string; status: "done" | "failed"; error?: string | null };
    },
    now: string,
  ): Promise<JobEnd | null> {
    if (this.#db.transact === undefined || this.#db.metadata.transactions === "sequential") {
      return null;
    }
    return await this.#db.transact<JobEnd>(async (tx) => {
      // A write first: it takes the row (and, on SQLite, the write lock, waiting for another process
      // as a plain statement does). A transaction that reads first and then writes holds a read
      // snapshot another process's commit makes stale, and SQLite refuses its upgrade at once.
      await tx.update(this.#table, jobId, { updatedAt: now });
      await settleAttemptIn(tx, this.#table, end.attempt, now);
      const before = (await tx.get(this.#table, jobId)) as unknown as CaptureJobRow | null;
      if (before === null) throw new Error("row not found");
      if (end.onlyOpen === true && isTerminalJob(before)) {
        return { applied: false, successor: null };
      }
      await tx.update(this.#table, jobId, endPatch(end, now));
      const successor = await handOver(tx, this.#table, before, end.status, now);
      return { applied: true, successor };
    });
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
    // The attempt about to run reads the current state, so it covers any rerun asked for before it.
    await this.#db.update(this.#table, jobId, {
      status: "running",
      attempt,
      visibleAt: null,
      rerunRequestedAt: null,
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

  /**
   * The last attempt lost its lease: the job row records that the exhausted-job hook runs as
   * `attempt` (numbered after the allowed attempts, so it also counts the runs) and leaves the
   * poll's range; the hook run's own attempt row carries the lease. Conditional on the job being
   * unfinished (a late `done` is never overwritten) and on no later run having been recorded: false
   * when it did not apply.
   */
  async markExhausting(
    jobId: string,
    attempt: number,
    error: string,
    now: string,
  ): Promise<boolean> {
    const row = (await this.#db.updateWhere(
      this.#table,
      jobId,
      { status: "exhausting", attempt, visibleAt: null, error, updatedAt: now },
      // A superseded run (a lower number) writes nothing.
      allOf(inArray(this.#c.status, ACTIVE_STATUSES), lt(this.#c.attempt, attempt)),
    )) as unknown as CaptureJobRow | null;
    // `updateWhere` returns the row either way; only our write leaves it exhausting at our run.
    return row?.status === "exhausting" && row.attempt === attempt;
  }

  /** End a job row for good unless it already ended (a late `done` or a cancel keeps its outcome). */
  async finishOpenJob(
    jobId: string,
    status: Exclude<CaptureJobStatus, "queued" | "running" | "exhausting">,
    now: string,
    error: string | null = null,
  ): Promise<void> {
    // Ending the job frees its `activeKey` in the same write; until then (while `exhausting`
    // included) the key stays held, so no second job for it can start.
    const patch = { status, visibleAt: null, activeKey: null, finishedAt: now, updatedAt: now };
    await this.#db.updateWhere(
      this.#table,
      jobId,
      error === null ? patch : { ...patch, error },
      inArray(this.#c.status, ACTIVE_STATUSES),
    );
  }

  /**
   * End a job row for good. The same statement frees its `activeKey`, so a later request for the
   * key creates a new job; there is no moment where the job is over but still holds the key.
   */
  async finishJob(
    jobId: string,
    status: Exclude<CaptureJobStatus, "queued" | "running" | "exhausting">,
    now: string,
    error: string | null = null,
  ): Promise<void> {
    const patch = { status, visibleAt: null, activeKey: null, finishedAt: now, updatedAt: now };
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

  /**
   * Hand a running attempt back without spending it: the job row is queued again, claimable at
   * once, and its `maxAttempts` grows by one so the attempt number just used does not count
   * (numbers stay unique and increasing, so a holder's receipt is never reused). Applies only while
   * the job row is `running` on `attempt` with no cancel asked, as read in `job`; the job write
   * comes first and is conditional, so a lost race (a cancel, a takeover) writes nothing. Resolves
   * true when applied; the attempt row then ends `released` (a crash before that leaves it to its
   * lease, which the next claim retires).
   */
  async release(job: CaptureJobRow, attempt: number, now: string): Promise<boolean> {
    const row = (await this.#db.updateWhere(
      this.#table,
      job.jobId,
      { status: "queued", maxAttempts: job.maxAttempts + 1, visibleAt: now, updatedAt: now },
      allOf(
        eq(this.#c.status, "running"),
        eq(this.#c.attempt, attempt),
        eq(this.#c.maxAttempts, job.maxAttempts),
        isNull(this.#c.cancelRequestedAt),
      ),
    )) as unknown as CaptureJobRow | null;
    if (row?.status !== "queued" || row.maxAttempts !== job.maxAttempts + 1) {
      return false;
    }
    await this.finishAttempt(attemptRowId(job.jobId, attempt), "released", now);
    return true;
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

  /** Whether the build has an unfinished job of `kind` (queued, running or exhausting). */
  async hasOpenJob(buildId: string, kind: CaptureJobKind): Promise<boolean> {
    return (await this.listForBuild(buildId)).some(
      (row) => row.kind === kind && ACTIVE_STATUSES.includes(row.status),
    );
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

  /** Job rows of `kinds` that are unfinished (queued, running or exhausting), oldest first. */
  async listActive(kinds: readonly CaptureJobKind[]): Promise<CaptureJobRow[]> {
    const rows = (await this.#db.list(this.#table, {
      where: and(
        jobEntries(this.#c),
        kindFilter(this.#c, kinds),
        inArray(this.#c.status, ACTIVE_STATUSES),
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

  /**
   * A build was removed: delete every `capture_jobs` row that points at it (job and attempt rows,
   * whatever their status). There is no foreign key, so retention does this by hand. Returns the
   * number of rows removed.
   */
  async removeForBuild(buildId: string): Promise<number> {
    const rows = (await this.#db.list(this.#table, {
      where: eq(this.#c.buildId, buildId),
    })) as unknown as CaptureJobRow[];
    await Promise.all(
      rows.map(async (row) => {
        await this.#db.remove(this.#table, row.id);
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
  activeKey: Column;
  rerunRequestedAt: Column;
  status: Column;
  attempt: Column;
  maxAttempts: Column;
  cancelRequestedAt: Column;
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
    activeKey: col(table, "activeKey"),
    rerunRequestedAt: col(table, "rerunRequestedAt"),
    status: col(table, "status"),
    attempt: col(table, "attempt"),
    maxAttempts: col(table, "maxAttempts"),
    cancelRequestedAt: col(table, "cancelRequestedAt"),
    visibleAt: col(table, "visibleAt"),
    createdAt: col(table, "createdAt"),
  };
}

/** `and(...)` of conditions that are all present (drizzle types its result as possibly undefined). */
/** The last stamp handed out; only ever moves forward. */
let lastStamp = 0;

/** An ISO timestamp no other call in this process returns twice, and later than `after`. */
function uniqueStamp(after: string): string {
  const seen = Date.parse(after);
  lastStamp = Math.max(Date.now(), lastStamp + 1, Number.isNaN(seen) ? 0 : seen + 1);
  return new Date(lastStamp).toISOString();
}

const TIMESTAMP_TEXT =
  /^(?<day>\d{4}-\d\d-\d\d)[T ](?<time>\d\d:\d\d:\d\d(?:\.\d+)?)(?<zone>Z|[+-]\d\d(?::?\d\d)?)?$/u;

/** Whether two timestamp texts (ISO, or a driver's `YYYY-MM-DD HH:MM:SS.mmm+00`) are one instant. */
function sameInstant(left: string, right: string): boolean {
  const instants = [left, right].map((text) => {
    const found = TIMESTAMP_TEXT.exec(text)?.groups;
    if (!found) return Number.NaN;
    const zone = found["zone"] ?? "Z";
    const offset = /^[+-]\d\d$/u.test(zone) ? `${zone}:00` : zone;
    return Date.parse(`${found["day"]}T${found["time"]}${offset}`);
  });
  return !Number.isNaN(instants[0]) && instants[0] === instants[1];
}

function allOf(first: SQL, ...rest: SQL[]): SQL {
  return and(first, ...rest) ?? first;
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
    activeKey: input.activeKey ?? null,
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
    activeKey: null,
    rerunRequestedAt: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** What {@link CaptureJobModel.endJob} did: whether it wrote the end, and the successor it queued. */
export interface JobEnd {
  applied: boolean;
  successor: CaptureJobRow | null;
}

/** The write that ends the job: frees its key and holds its row until the commit. */
function endPatch(
  end: { status: string; error?: string | null },
  now: string,
): Record<string, unknown> {
  const patch = {
    status: end.status,
    visibleAt: null,
    activeKey: null,
    finishedAt: now,
    updatedAt: now,
  };
  const error = end.error ?? null;
  return error === null ? patch : { ...patch, error };
}

/** Ends the attempt that ran the job inside the end's transaction (a no-op without one). */
async function settleAttemptIn(
  tx: TxStore,
  table: Table,
  attempt: { id: string; status: "done" | "failed"; error?: string | null } | undefined,
  now: string,
): Promise<void> {
  if (attempt === undefined) return;
  await tx.update(table, attempt.id, {
    status: attempt.status,
    visibleAt: null,
    error: attempt.error ?? null,
    finishedAt: now,
    updatedAt: now,
  });
}

/**
 * Inside the transaction that ended `jobId`: if a request is owed (the marker is set) and the job
 * did not end `cancelled`, take the marker and queue the successor for the key the job just freed.
 */
async function handOver(
  tx: TxStore,
  table: Table,
  before: CaptureJobRow,
  status: string,
  now: string,
): Promise<CaptureJobRow | null> {
  // `before` is the row as it was when the end was written; the key is gone from the row since.
  const key = before.activeKey;
  if (status === "cancelled" || key === null) return null;
  // Read after the end: a request that set the marker first is seen, and none can set it later.
  const ended = (await tx.get(table, before.jobId)) as unknown as CaptureJobRow | null;
  if (!ended?.rerunRequestedAt) return null;
  await tx.update(table, before.jobId, { rerunRequestedAt: null });
  return (await tx.insert(
    table,
    jobRow(
      {
        id: ulid(),
        kind: before.kind,
        buildId: before.buildId,
        shardId: before.shardId,
        maxAttempts: before.maxAttempts,
        payload: before.payload,
        activeKey: key,
      },
      now,
    ),
  )) as unknown as CaptureJobRow;
}
